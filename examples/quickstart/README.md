# quickstart: a notes API in Next.js

The finished code of the [quick start](https://onedef.cahidarda.com/docs/quickstart): one
contract, one backend, and two route files give you REST, OpenAPI and an MCP server, plus a
page that calls the API through the typed client.

```
lib/contract.ts                 the contract: a `notes` collection with create and a `complete` action
lib/backend.ts                  implement(contract, handlers), over an in-memory Map
app/api/[[...route]]/route.ts   REST, RPC and /api/openapi.json: toNextHandlers(backend)
app/mcp/route.ts                the MCP server at /mcp: createMcpHandler(backend)
app/page.tsx                    a client page: createClient(contract, rpc({ url: '/api' }))
```

## Run it

From the repo root:

```bash
pnpm install && pnpm build                   # once: builds the onedef packages
pnpm --filter @example/quickstart dev        # http://localhost:3000
```

From this folder: `pnpm dev` (or `pnpm build && pnpm start`).

## Try it

```bash
curl -X POST localhost:3000/api/notes -H 'content-type: application/json' -d '{"title":"Buy milk"}'
curl localhost:3000/api/notes
curl -X POST localhost:3000/api/notes/<id>/complete
curl localhost:3000/api/openapi.json
```

Connect Claude Code to the MCP server and ask in plain words:

```bash
claude mcp add --transport http notes http://localhost:3000/mcp
# > Add a note titled "Call mom", mark it as done, then list my notes.
```

Or open the [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
(`npx @modelcontextprotocol/inspector`) on `http://localhost:3000/mcp` and call
`notes_create`, `notes_complete`, `notes_list`.

## Docs

- [Quick start](https://onedef.cahidarda.com/docs/quickstart): this example, step by step
- [Contract](https://onedef.cahidarda.com/docs/define/contract) · [Backend](https://onedef.cahidarda.com/docs/define/backend)
- [REST and OpenAPI](https://onedef.cahidarda.com/docs/serve/rest) · [MCP server](https://onedef.cahidarda.com/docs/serve/mcp)
- [All examples](https://onedef.cahidarda.com/docs/examples)
