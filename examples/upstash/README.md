# upstash: describing an API that already exists

A contract for part of the real Upstash developer API. Each op carries an `http`
descriptor, so the SDK, CLI and MCP server call `api.upstash.com` directly with no onedef
server in between. One op, `query`, has no upstream endpoint and is implemented with
`@upstash/redis`: the two modes mixed in one contract.

```
contract/   the contract with http descriptors (contract.ts) + implement() for `query` (backend.ts)
app/        React console + REST/RPC/OpenAPI at /api + MCP at /mcp, one Vite process on :3000
cli/        publishable `upstash-redis` CLI (+ generated agent skill)
mcp/        publishable `upstash-redis-mcp` stdio server
sdk/        publishable typed client: createClient(contract, http({ auth }))
stub.mjs    a stand-in for api.upstash.com on :4010, to run everything offline
```

Packages: `@example/upstash-contract` (`./backend` for the backend), `@example/upstash-app`,
`-cli`, `-mcp`, `-sdk`.

## Who calls what

| surface | transport | descriptor ops (list, get, create, rename, delete) | `query` |
| --- | --- | --- | --- |
| SDK | `http({ auth })` | straight to api.upstash.com | not available (`NOT_IMPLEMENTED`) |
| CLI, stdio MCP | `local(backend)` | straight to api.upstash.com (proxied in process) | runs in process |
| app (console, REST, `/mcp`) | the hosted backend | proxied as the caller, or as the server's `.env` account | runs on the server |

`query` calls `get` through the backend to read the database's REST endpoint and token,
then talks to the database. Tokens never reach the browser, and `select` strips them from
list responses on every surface.

## Run it

From the repo root:

```bash
pnpm install && pnpm build                       # once: builds the onedef packages
node examples/upstash/stub.mjs &                 # offline upstream on :4010 (skip for the real API)
export UPSTASH_API_URL=http://localhost:4010 UPSTASH_EMAIL=me@example.com UPSTASH_API_KEY=key
pnpm --filter @example/upstash-app dev           # http://localhost:3000: console, /api, /mcp
```

From this folder: `node stub.mjs &`, then `cd app && pnpm dev`.

> Without `UPSTASH_API_URL` everything hits your real Upstash account: create and delete
> are real. Credentials are an account email and a developer API key (HTTP Basic), from the
> environment or a `.env` next to each runnable package. `UPSTASH_TEAM_ID` or `--team`
> selects a team.

## Try it

With the stub and the environment above (the CLI and MCP server don't need the app):

| surface | command |
| --- | --- |
| REST | `curl localhost:3000/api/redis` · `curl localhost:3000/api/openapi.json` |
| CLI | `pnpm --filter @example/upstash-cli cli redis list` |
| CLI, the implemented op | `pnpm --filter @example/upstash-cli cli redis query db_1 --command '["PING"]'` |
| MCP over stdio | `pnpm --filter @example/upstash-mcp verify` · `… inspect` (MCP Inspector) |
| MCP over HTTP | `claude mcp add --transport http upstash http://localhost:3000/mcp` |
| agent skill | `pnpm --filter @example/upstash-cli skill` → `cli/skills/upstash-redis-cli/SKILL.md` |
| build an artifact | `pnpm --filter @example/upstash-sdk build` (or `-cli`, `-mcp`) |

## What else it shows

- **Real endpoints**: list is `/v2/redis/databases` (plural), get `/v2/redis/database/{id}`,
  rename `/v2/redis/rename/{id}`.
- **A collection's create**: no id in the client's input type, the CLI args, the MCP tool
  schema or the route.
- **Publishable artifacts without publishing the contract**: the SDK, CLI and MCP builds
  bundle it; remove `"private": true` to publish.

## Docs

- [Describing an existing API](https://onedef.cahidarda.com/docs/define/existing-api)
- [Contract](https://onedef.cahidarda.com/docs/define/contract) · [Backend](https://onedef.cahidarda.com/docs/define/backend)
- [CLI](https://onedef.cahidarda.com/docs/clients/cli) · [SDK](https://onedef.cahidarda.com/docs/clients/sdk) · [MCP server](https://onedef.cahidarda.com/docs/serve/mcp)
- [All examples](https://onedef.cahidarda.com/docs/examples)
