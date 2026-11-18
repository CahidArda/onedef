import { action, collection, defineApi, defineConfig } from 'onedef'
import { z } from 'zod'

/**
 * The contract: what the API is, with no server code. It is safe to import
 * from a browser, a CLI or a published SDK — handlers live in `./backend.ts`,
 * which only the server imports.
 */
export const config = defineConfig({
  name: 'acme',
  version: '1.0.0',
  description: 'Acme hosts toy Redis databases. List them, read their credentials, rename and rotate them.',
  auth: {
    apiKey: { env: 'ACME_API_KEY', description: 'Any non-empty string works against the example backend.' },
  },
  scopes: {
    team: {
      header: 'Acme-Team-Id',
      description: 'Team to operate on. Omit to use your personal account.',
      required: false,
    },
  },
  // credential modes: OAuth callers (the public MCP endpoint, the docs) never see tokens
  modes: ['apikey', 'oauth'],
})

const Database = z.object({
  database_id: z.string().describe('Unique database identifier'),
  database_name: z.string().describe('Human-readable name'),
  region: z.string().describe('Primary region'),
  state: z.enum(['active', 'deleted']).describe('Lifecycle state'),
})

/** Detail is a different shape from the list rows: only `get` returns credentials. */
const DatabaseDetail = Database.extend({
  endpoint: z.string().describe('TLS endpoint hostname'),
  rest_token: z.string().describe('REST API token'),
  read_only_token: z.string().describe('Read-only REST token'),
})

/**
 * A collection: many databases addressed by `database_id`. `list` and `get`
 * always exist; `create` and `delete` because they are declared; the rest are
 * actions — your own verbs.
 */
export const redis = collection(config, {
  name: 'redis',
  description:
    'Serverless Redis databases. Use list to discover databases, then get to read credentials, which list omits.',
  id: 'database_id',
  fields: DatabaseDetail,
  summary: Database,
  // Only apikey callers see tokens: stripped from schemas and values for every other mode.
  restrict: { rest_token: ['apikey'], read_only_token: ['apikey'] },
  list: {
    input: z.object({ region: z.string().optional().describe('Filter by region') }),
    scope: ['team'],
  },
  create: {
    input: z.object({
      name: z.string().min(1).describe('Database name'),
      region: z.string().default('us-east-1').describe('Primary region'),
    }),
    scope: ['team'],
  },
  delete: true,
  actions: {
    rename: action({
      summary: 'Rename a database',
      input: z.object({ name: z.string().min(1).describe('The new database name') }),
      output: DatabaseDetail,
      idempotent: true,
    }),
    resetPassword: action({
      summary: 'Rotate the tokens of a database',
      output: DatabaseDetail,
      destructive: true,
      modes: ['apikey'],
    }),
  },
})

export const contract = defineApi(config, { redis })
