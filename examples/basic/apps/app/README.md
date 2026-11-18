# @example/app

Frontend and backend in one project, no framework.

```bash
pnpm dev      # vite on :3000: React (hot reload) + /api + /mcp in one process
pnpm build    # vite build → dist/
pnpm start    # production: the same handler + dist/, one port (PORT, default 3000)
pnpm demo     # a typed RPC client and an MCP client against the running app
```

`server/handler.ts` is the whole backend: `toFetchHandler(backend)` (RPC at
`/api/rpc`, REST under `/api`, `/api/openapi.json`) and
`createMcpHandler(forMode(backend, 'oauth'))` at `/mcp`. Both are web
`(Request) => Response` functions; `@hono/node-server` adapts them to node, in
vite's dev middleware and in `server/main.ts`.

The frontend (`src/client.ts`) is `createClient(contract, rpc({ url: '/api' }))`:
the contract carries schemas, never handlers, so nothing server-side reaches
the bundle. Scope is per call (`{ scope: { team } }`), and every type comes
from the contract (`db.rest_token` on a list row is a compile error).
