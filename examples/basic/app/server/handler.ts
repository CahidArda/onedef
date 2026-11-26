import { backend } from '@example/basic-contract/backend'
import { createMcpHandler } from '@onedef/mcp'
import { toFetchHandler } from '@onedef/orpc'
import { forMode } from 'onedef'

/**
 * The whole backend as one web `(Request) => Response` function, shared by
 * vite (dev) and server/main.ts (prod):
 *
 *   /api/rpc/*         oRPC, what the React app, CLI, stdio MCP and SDK call
 *   /api/openapi.json  the OpenAPI document
 *   /api/...           REST, e.g. GET /api/redis/{database_id}
 *   /mcp               MCP over Streamable HTTP, handlers run in process
 *
 * The /mcp endpoint is what remote agents (Claude, ChatGPT) connect to, so it
 * serves the OAuth surface: tokens are absent from its tool schemas and
 * results, and the apikey-only `reset-password` is not a tool at all.
 */
const api = toFetchHandler(backend)
const mcp = createMcpHandler(forMode(backend, 'oauth'))

export const isBackendPath = (path: string) => path === '/api' || path.startsWith('/api/') || path.startsWith('/mcp')

export const handle = (request: Request): Promise<Response> =>
  new URL(request.url).pathname.startsWith('/mcp') ? mcp(request) : api(request)
