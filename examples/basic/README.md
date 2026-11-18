# onedef example: with backend functions

The template for "mode 1": one contract, handlers on the server, every other
surface a client of that server. Runs offline with zero setup (the backend is
an in-memory store).

```
packages/recipe   the contract (`@example/recipe`, client-safe) + the backend
                  (`@example/recipe/backend`, server only, `implement()`)
packages/sdk      the releasable SDK: createClient(contract, rpc(...)), recipe bundled in
apps/app          React frontend + toFetchHandler(backend) at /api + createMcpHandler at /mcp
apps/cli          runCli(contract, { transport: rpc({ url }) })   → `acme` binary
apps/mcp          serveMcpStdio(contract, { transport: rpc({ url }) })
apps/docs         generateOpenApi(contract) + writeMintlifySite → a Mintlify site
```

## Try it

```bash
pnpm install && pnpm build                 # build the onedef packages once
pnpm --filter @example/app dev             # :3000 — React + /api + /mcp (or: build && start)
```

Then, with the app running:

| surface                          | command                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| REST + OpenAPI                   | `curl localhost:3000/api/redis` · `curl localhost:3000/api/openapi.json`                                       |
| typed RPC client + MCP over HTTP | `pnpm --filter @example/app demo`                                                                              |
| CLI                              | `pnpm --filter @example/cli cli redis list` (built: `pnpm --filter @example/cli build && npx acme redis list`) |
| MCP over stdio                   | `pnpm --filter @example/mcp verify` · `pnpm --filter @example/mcp inspect`                                     |
| docs                             | `pnpm --filter @example/docs build` (regenerate) · `dev` (+ `mint dev`)                                        |
| agent skill                      | `pnpm --filter @example/cli skill`                                                                             |
| SDK                              | `pnpm --filter @example/sdk build`                                                                             |

## The dev loop

Edit `packages/recipe/src/contract.ts` (add a field, an op, a scope) and
`backend.ts` fails to compile until the handler exists. Then every surface has
it, with no build step: the app hot-reloads, the CLI shows the new command,
the MCP server lists the new tool, `docs build` adds the page.

## Credential modes

The contract declares `modes: ['apikey', 'oauth']` and hides the tokens from
`oauth`. `forMode(…, 'oauth')` projects that surface: the app's public `/mcp`
and the docs use it, so tokens and the apikey-only `reset-password` are absent
from their schemas and results. The RPC API, CLI and SDK see the full contract.
