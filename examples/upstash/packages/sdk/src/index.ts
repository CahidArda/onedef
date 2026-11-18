// The recipe is NEVER published; relative import on purpose: to this package
// the contract is internal source. tsup inlines its runtime (schemas and
// descriptors, never backend.ts) and tsc emits its declarations into dist/.
import { contract } from '../../recipe/src/contract.js'
import { createClient, http, type ApiClient, type Credentials, type OutputOf } from 'onedef'

export type { Credentials }

export interface UpstashClientOptions {
  /** Read per call: `() => ({ basic: { username: email, password: apiKey } })`. */
  auth: () => Credentials | undefined
  /** Default `https://api.upstash.com`. */
  baseUrl?: string
  /** Default team; any call may override it with `{ scope: { team } }`. */
  team?: () => string | undefined
}

export type UpstashClient = ApiClient<typeof contract>

/** Derived from the contract: the SDK ships no hand-written response types. */
export type RedisDatabase = OutputOf<typeof contract, 'redis', 'list'>[number]
export type RedisDatabaseDetail = OutputOf<typeof contract, 'redis', 'get'>

/**
 * Calls the Upstash developer API directly, no server in between. `redis.query`
 * is not on that API (it needs the backend's code), so over this client it
 * fails with NOT_IMPLEMENTED; use the CLI or a deployed app for it.
 */
export function createUpstashClient(options: UpstashClientOptions): UpstashClient {
  return createClient(
    contract,
    http({ auth: options.auth, ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) }),
    {
      scope: () => ({ team: options.team?.() }),
    },
  )
}
