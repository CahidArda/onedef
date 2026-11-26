// load .env before the backend reads process.env (in prod and under vite's ssrLoadModule alike)
import 'dotenv/config'
import { backend } from '@example/upstash-contract/backend'
import { createMcpHandler } from '@onedef/mcp'
import { toFetchHandler } from '@onedef/orpc'

/**
 * The app hosts the backend: RPC (what the console calls), REST and
 * /api/openapi.json under /api, and MCP at /mcp. Ops with an `http`
 * descriptor are proxied to api.upstash.com as the caller (or as the
 * server's .env account when the caller sends nothing, like this console);
 * `query` runs its handler here.
 */
const api = toFetchHandler(backend)
const mcp = createMcpHandler(backend)

export const isBackendPath = (path: string) => path === '/api' || path.startsWith('/api/') || path.startsWith('/mcp')

export const handle = (request: Request): Promise<Response> =>
  new URL(request.url).pathname.startsWith('/mcp') ? mcp(request) : api(request)
