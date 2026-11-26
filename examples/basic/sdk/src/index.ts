// The contract package is NEVER published, and this import is relative on purpose: to
// this package the contract is internal source, not a dependency. The build
// makes the published artifact self-contained anyway:
//  - tsup inlines the contract's runtime (schemas only: the backend lives in
//    another file this one never imports, so no handler can be bundled)
//  - tsc emits the contract's declarations INTO dist/, so consumers get full
//    end-to-end types without the contract existing on npm
import { contract } from '../../contract/src/contract.js'
import { rpc } from '@onedef/orpc/client'
import { createClient, type ApiClient, type OutputOf } from 'onedef'

export interface AcmeClientOptions {
  /** Where the backend is mounted. Default `http://localhost:3000/api`. */
  url?: string
  /** Read per call, so a rotated key is picked up without rebuilding the client. */
  apiKey?: () => string | undefined
  /** Default team; any call may override it with `{ scope: { team } }`. */
  team?: () => string | undefined
}

export type AcmeClient = ApiClient<typeof contract>

/** Derived from the contract: the SDK ships no hand-written response types. */
export type Database = OutputOf<typeof contract, 'redis', 'list'>[number]
export type DatabaseDetail = OutputOf<typeof contract, 'redis', 'get'>

export function createAcmeClient(options: AcmeClientOptions = {}): AcmeClient {
  return createClient(
    contract,
    rpc({
      url: options.url ?? 'http://localhost:3000/api',
      auth: () => {
        const apiKey = options.apiKey?.()
        return apiKey ? { apiKey } : undefined
      },
    }),
    { scope: () => ({ team: options.team?.() }) },
  )
}
