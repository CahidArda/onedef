# @example/basic-app

Frontend and backend in one Vite project, no framework.

```
src/              React UI: createClient(contract, rpc({ url: '/api' }))
server/handler.ts the whole backend as one fetch handler: /api (REST, RPC, OpenAPI) and /mcp
server/main.ts    production server: the same handler + the built frontend, one port
scripts/demo.ts   a typed RPC client and an MCP client against the running app
```

```bash
pnpm dev      # :3000, React with hot reload + /api + /mcp in one process
pnpm build    # vite build → dist/
pnpm start    # production: handler + dist/ on PORT (default 3000)
pnpm demo     # needs the app running
```

From the repo root: `pnpm --filter @example/basic-app <script>`.

`server/handler.ts` is `toFetchHandler(backend)` (RPC at `/api/rpc`, REST under `/api`,
`/api/openapi.json`) and `createMcpHandler(forMode(backend, 'oauth'))` at `/mcp`. Both are
web `(Request) => Response` functions; `@hono/node-server` adapts them to Node, in Vite's
dev middleware and in `server/main.ts`.

The frontend imports the contract, never the backend, so no server code reaches the bundle.
Scope is per call (`{ scope: { team } }`), and every type comes from the contract
(`db.rest_token` on a list row is a compile error).

Docs: [REST and OpenAPI](https://onedef.cahidarda.com/docs/serve/rest) ·
[MCP server](https://onedef.cahidarda.com/docs/serve/mcp) ·
[Clients](https://onedef.cahidarda.com/docs/clients)
