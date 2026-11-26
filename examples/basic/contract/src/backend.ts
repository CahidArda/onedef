import { fail, implement } from 'onedef'
import { contract } from './contract.js'

/**
 * Server only: the contract with its handlers attached. Nothing but the app's
 * server imports this file, so no handler can end up in a browser, CLI or SDK
 * bundle. The store is in memory so the example runs offline with zero setup;
 * swap it for your database.
 */
interface Row {
  database_id: string
  database_name: string
  region: string
  state: 'active' | 'deleted'
  endpoint: string
  rest_token: string
  read_only_token: string
  team: string
}

const rows = new Map<string, Row>()
const token = () => crypto.randomUUID().replaceAll('-', '')

function insert(team: string, name: string, region: string): Row {
  const id = `db_${rows.size + 1}`
  const row: Row = {
    database_id: id,
    database_name: name,
    region,
    state: 'active',
    endpoint: `${id}.${region}.acme.test`,
    rest_token: token(),
    read_only_token: token(),
    team,
  }
  rows.set(id, row)
  return row
}
insert('personal', 'cache', 'us-east-1')

const find = (id: string) => rows.get(id) ?? fail('NOT_FOUND', `No database "${id}"`)

// Outputs are validated against the contract, so `team` (not in any output
// schema) is stripped before it leaves the server.
export const backend = implement(contract, {
  redis: {
    list: ({ input, scope }) =>
      [...rows.values()].filter(
        (row) => row.team === (scope.team ?? 'personal') && (!input.region || row.region === input.region),
      ),
    get: ({ id }) => find(id),
    create: ({ input, scope }) => insert(scope.team ?? 'personal', input.name, input.region),
    rename: ({ id, input }) => Object.assign(find(id), { database_name: input.name }),
    resetPassword: ({ id }) => Object.assign(find(id), { rest_token: token(), read_only_token: token() }),
    delete: ({ id }) => {
      find(id)
      rows.delete(id)
    },
  },
})
