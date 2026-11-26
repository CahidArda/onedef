import { contract } from '@example/upstash-contract'
import { rpc } from '@onedef/orpc/client'
import { createClient, type OutputOf } from 'onedef'

/**
 * The console is a client of OUR backend, not of Upstash: it carries no
 * Upstash credentials (those live in the server's .env), and `query` needs
 * the backend's code anyway. Per-user auth for your own service would slot in
 * here as `rpc({ url, auth })`.
 */
export const client = createClient(contract, rpc({ url: '/api' }))

export type RedisDb = OutputOf<typeof contract, 'redis', 'list'>[number]
