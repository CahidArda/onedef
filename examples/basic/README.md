# basic: every surface from one contract

One contract (`acme`, a toy Redis host), handlers on the server, and every other surface
built from it: a React app with REST and `/mcp`, a CLI, a stdio MCP server, a releasable SDK
and a Mintlify docs site. Runs offline: the backend is an in-memory store.

```
contract/   the contract (contract.ts, client-safe) and the backend (backend.ts, server only)
app/        React app + REST/RPC/OpenAPI at /api + MCP at /mcp, one Vite process on :3000
cli/        `acme` CLI: runCli(contract, rpc(...)), plus a generated agent skill
mcp/        stdio MCP server that forwards to the app over RPC
sdk/        releasable typed client; bundles the contract, never the backend
docs/       Mintlify site generated from the contract (generator in docs/scripts)
```

| package | name |
| --- | --- |
| `contract/` | `@example/basic-contract` (`.` = contract, `./backend` = backend) |
| `app/`, `cli/`, `mcp/`, `sdk/`, `docs/scripts/` | `@example/basic-app`, `-cli`, `-mcp`, `-sdk`, `-docs` |

## Run it

From the repo root:

```bash
pnpm install && pnpm build                  # once: builds the onedef packages
pnpm --filter @example/basic-app dev        # http://localhost:3000: app, /api, /mcp
```

Or from this folder: `cd app && pnpm dev`. Everything below needs the app running.

## Try it

REST and OpenAPI:

```bash
curl localhost:3000/api/redis
curl localhost:3000/api/redis/db_1
curl -X POST localhost:3000/api/redis -H 'content-type: application/json' -d '{"name":"sessions"}'
curl -X POST localhost:3000/api/redis/db_1/rename -H 'content-type: application/json' -d '{"name":"main"}'
curl localhost:3000/api/openapi.json
```

The other surfaces (each runs from the repo root; inside the package folder drop the
`--filter` part):

| surface | command |
| --- | --- |
| typed client + MCP client | `pnpm --filter @example/basic-app demo` |
| CLI | `pnpm --filter @example/basic-cli cli redis list` · `… cli redis get db_1` · `… cli --help` |
| MCP over HTTP | `claude mcp add --transport http acme http://localhost:3000/mcp`, or the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) on that URL |
| MCP over stdio | `pnpm --filter @example/basic-mcp verify` · `pnpm --filter @example/basic-mcp inspect` |
| docs site | `pnpm --filter @example/basic-docs build` (generate) · `… dev` (generate + `mint dev`) |
| agent skill | `pnpm --filter @example/basic-cli skill` → `cli/skills/acme-cli/SKILL.md` |
| SDK build | `pnpm --filter @example/basic-sdk build` |

## The dev loop

Add a field or an action in `contract/src/contract.ts`. `backend.ts` stops compiling until
the handler exists; then every surface has it with no build step: the app hot-reloads, the
CLI shows the command, the MCP server lists the tool, `docs build` adds the page.

## Credential modes

The contract declares `modes: ['apikey', 'oauth']` and restricts the tokens to `apikey`.
`forMode(…, 'oauth')` projects the public surfaces: the app's `/mcp` and the docs never show
tokens or the apikey-only `reset-password`. REST/RPC, the CLI and the SDK see everything.

## Docs

- [Contract](https://onedef.cahidarda.com/docs/define/contract) · [Backend](https://onedef.cahidarda.com/docs/define/backend)
- [REST and OpenAPI](https://onedef.cahidarda.com/docs/serve/rest) · [MCP server](https://onedef.cahidarda.com/docs/serve/mcp) · [API docs](https://onedef.cahidarda.com/docs/serve/api-docs)
- [CLI](https://onedef.cahidarda.com/docs/clients/cli) · [SDK](https://onedef.cahidarda.com/docs/clients/sdk)
- [All examples](https://onedef.cahidarda.com/docs/examples)
