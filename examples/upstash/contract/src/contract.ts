import { defineApi, defineConfig, defineService, mutation, query } from 'onedef'
import { z } from 'zod'
import { REGIONS } from './regions.js'

export { REGIONS }

/**
 * The real Upstash developer API, described rather than implemented: every op
 * but `query` carries an `http` descriptor, so clients call api.upstash.com
 * directly and no onedef server is needed for them.
 */
export const config = defineConfig({
  name: 'upstash-redis',
  version: '1.0.0',
  description: 'Manage Upstash Redis databases: list, inspect, create, rename, delete, and run Redis commands.',
  baseUrl: 'https://api.upstash.com',
  toolPrefix: 'upstash',
  auth: {
    // RFC 7617 Basic, account email + developer API key (console → Account → Management API)
    basic: {
      userEnv: 'UPSTASH_EMAIL',
      passwordEnv: 'UPSTASH_API_KEY',
      description: 'Your account email and a developer API key.',
    },
  },
  scopes: {
    team: {
      header: 'Upstash-Team-Id',
      description: 'Team to operate on. Omit to use your personal account.',
      required: false,
    },
  },
})

const RedisSummary = z.object({
  database_id: z.string().describe('Unique database identifier'),
  database_name: z.string().describe('Human-readable name'),
  state: z.string().describe('Lifecycle state'),
  primary_region: z.string().optional().describe('Primary region'),
  creation_time: z.number().optional().describe('Unix timestamp of creation'),
})

/** Detail carries what the summary deliberately omits: endpoint and credentials. */
const RedisDetail = RedisSummary.extend({
  endpoint: z.string().optional().describe('REST/TCP endpoint hostname'),
  port: z.number().optional().describe('TCP port'),
  password: z.string().optional().describe('Database password'),
  rest_token: z.string().optional().describe('REST API token'),
  read_only_rest_token: z.string().optional().describe('Read-only REST token'),
  tls: z.boolean().optional().describe('TLS enabled'),
  read_regions: z.array(z.string()).optional().describe('Read replica regions'),
})

// the upstream returns credentials even in list responses: the summary drops them
const summary = (raw: Record<string, any>): z.infer<typeof RedisSummary> => ({
  database_id: raw.database_id,
  database_name: raw.database_name,
  state: raw.state ?? 'unknown',
  primary_region: raw.primary_region ?? raw.region,
  creation_time: raw.creation_time,
})

export const redis = defineService(config, {
  name: 'redis',
  description:
    'Upstash Redis databases. list shows names and ids; get returns the endpoint and REST credentials; ' +
    'query runs a Redis command against a database.',
  id: 'database_id',
  // Endpoints verified against the official Upstash CLI. Note the asymmetry of
  // the real API: list is /databases (plural), get is /database/{id}.
  ops: {
    list: query({
      summary: 'List databases',
      output: z.array(RedisSummary),
      scope: ['team'],
      http: {
        method: 'GET',
        path: '/v2/redis/databases',
        select: (raw: Record<string, any>[]) => raw.map(summary),
        errors: { 401: 'UNAUTHORIZED', 429: 'RATE_LIMITED' },
      },
    }),
    get: query({
      on: 'member',
      summary: 'Get a database with its endpoint and credentials',
      output: RedisDetail,
      http: { method: 'GET', path: '/v2/redis/database/{id}', errors: { 401: 'UNAUTHORIZED', 404: 'NOT_FOUND' } },
    }),
    create: mutation({
      summary: 'Create a database',
      input: z.object({
        name: z.string().min(1).describe('Database name'),
        primary_region: z.enum(REGIONS).describe('Primary region'),
        read_regions: z.array(z.enum(REGIONS)).optional().describe('Read replica regions'),
      }),
      output: RedisDetail,
      scope: ['team'],
      http: {
        method: 'POST',
        path: '/v2/redis/database',
        // the API's create shape differs from ours: global type + explicit primary
        body: ({ input }) => ({
          database_name: input.name,
          region: 'global',
          primary_region: input.primary_region,
          read_regions: input.read_regions,
        }),
        errors: { 401: 'UNAUTHORIZED', 400: 'INVALID_INPUT', 402: 'QUOTA_EXCEEDED' },
      },
    }),
    rename: mutation({
      on: 'member',
      summary: 'Rename a database',
      input: z.object({ name: z.string().min(1).describe('The new database name') }),
      output: RedisDetail,
      idempotent: true,
      http: { method: 'POST', path: '/v2/redis/rename/{id}', errors: { 401: 'UNAUTHORIZED', 404: 'NOT_FOUND' } },
    }),
    delete: mutation({
      on: 'member',
      summary: 'Delete a database permanently',
      destructive: true,
      http: { method: 'DELETE', path: '/v2/redis/database/{id}', errors: { 401: 'UNAUTHORIZED', 404: 'NOT_FOUND' } },
    }),
    // No `http`: this one is not on the developer API, it needs code (see ./backend.ts)
    query: mutation({
      on: 'member',
      summary: 'Run a Redis command against a database',
      description:
        'Executes one command via the database REST API, e.g. ["SET","greeting","hello"] or ["GET","greeting"].',
      input: z.object({
        command: z
          .array(z.union([z.string(), z.number()]))
          .min(1)
          .describe('The command as tokens, e.g. ["SET", "key", "value"]'),
      }),
      output: z.object({ result: z.unknown().describe('The command reply') }),
    }),
  },
})

export const contract = defineApi(config, { redis })
