import { contract } from '@example/recipe'
import { rpc } from '@onedef/orpc/client'
import { createClient, type OutputOf } from 'onedef'

/**
 * One client for the whole app. The contract is client-safe (schemas, no
 * handlers), and the transport is the backend's RPC endpoint on this origin.
 * Scope is per call, so switching teams never rebuilds this.
 */
export const client = createClient(contract, rpc({ url: '/api' }))

/** Derived from the contract: no hand-written response types anywhere. */
export type Database = OutputOf<typeof contract, 'redis', 'list'>[number]
