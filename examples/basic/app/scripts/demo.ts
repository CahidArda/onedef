import { contract } from '@example/basic-contract'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { rpc } from '@onedef/orpc/client'
import { createClient } from 'onedef'

// Run against a running app (`pnpm dev` or `pnpm start`): the same backend
// reached as a typed RPC client and as an MCP server.
const origin = process.env.APP_URL ?? 'http://localhost:3000'

const client = createClient(contract, rpc({ url: `${origin}/api` }))
const created = await client.redis.create({ name: 'demo' }, { scope: { team: 'team_42' } })
console.log('rpc  create          ', created.database_id, created.database_name)
console.log(
  'rpc  list @team_42   ',
  (await client.redis.list({}, { scope: { team: 'team_42' } })).map((d) => d.database_name),
)
console.log(
  'rpc  rename          ',
  (await client.redis.rename({ database_id: created.database_id, name: 'renamed' })).database_name,
)
console.log('rpc  get             ', (await client.redis.get({ database_id: created.database_id })).endpoint)

const mcp = new Client({ name: 'demo', version: '1.0.0' })
await mcp.connect(
  new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { 'acme-team-id': 'team_42' } },
  }),
)
console.log(
  'mcp  tools           ',
  (await mcp.listTools()).tools.map((tool) => tool.name),
)
const got = await mcp.callTool({ name: 'redis_get', arguments: { database_id: created.database_id } })
console.log('mcp  redis_get       ', got.structuredContent, '(oauth surface: no tokens)')
await mcp.close()
