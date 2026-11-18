// A stand-in for api.upstash.com, so the example runs offline:
//   node stub.mjs &  export UPSTASH_API_URL=http://localhost:4010 UPSTASH_EMAIL=me@x.dev UPSTASH_API_KEY=k
// It serves the developer API routes the contract uses, plus a database REST
// endpoint (POST /redis) so `query` works end to end. It logs each request's
// auth scheme and team, to check what every surface actually sends.
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 4010)
const origin = `http://localhost:${PORT}`
const dbs = new Map()
const add = (name, team, region = 'us-east-1') => {
  const id = `db_${dbs.size + 1}`
  dbs.set(id, {
    database_id: id,
    database_name: name,
    state: 'active',
    primary_region: region,
    creation_time: 1700000000,
    endpoint: `${origin}/redis`,
    port: 6379,
    password: 'SECRET',
    rest_token: 'SECRET_REST',
    read_only_rest_token: 'SECRET_RO',
    tls: true,
    team,
  })
  return dbs.get(id)
}
add('cache', 'personal')
add('sessions', 'team_42', 'eu-west-1')
const store = new Map()

const json = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))

createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const team = req.headers['upstash-team-id'] ?? 'personal'
  const scheme = (req.headers.authorization ?? 'none').split(' ')[0]
  console.log(`${req.method} ${req.url}  auth=${scheme}  team=${team}`)
  if (scheme !== 'Basic' && scheme !== 'Bearer') return json(res, 401, { error: 'unauthorized' })

  const [, , , what, id] = req.url.split('/') // /v2/redis/<what>/<id>
  if (req.url === '/redis' && req.method === 'POST') {
    const [command, key, value] = JSON.parse(body)
    const op = String(command).toUpperCase()
    const result =
      op === 'SET'
        ? (store.set(key, String(value)), 'OK')
        : op === 'GET'
          ? (store.get(key) ?? null)
          : op === 'PING'
            ? 'PONG'
            : null
    // @upstash/redis asks for base64 replies, as the real REST API supports
    const encode = req.headers['upstash-encoding'] === 'base64' && typeof result === 'string'
    return json(res, 200, { result: encode ? Buffer.from(result).toString('base64') : result })
  }
  if (req.method === 'GET' && what === 'databases') {
    return json(
      res,
      200,
      [...dbs.values()].filter((db) => db.team === team),
    )
  }
  if (req.method === 'POST' && what === 'database' && !id) {
    const input = JSON.parse(body)
    return json(res, 200, add(input.database_name, team, input.primary_region))
  }
  const db = dbs.get(id)
  if (!db) return json(res, 404, { error: 'database not found' })
  if (req.method === 'GET' && what === 'database') return json(res, 200, db)
  if (req.method === 'POST' && what === 'rename')
    return ((db.database_name = JSON.parse(body).name), json(res, 200, db))
  if (req.method === 'DELETE' && what === 'database') return (dbs.delete(id), json(res, 200, 'OK'))
  json(res, 404, { error: 'no route' })
}).listen(PORT, () => console.log(`upstash stub on ${origin}`))
