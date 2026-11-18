# onedef example: without backend functions

"Mode 2" against the **real Upstash developer API**. The contract says where
each op already lives (`http` descriptors), so most surfaces need no onedef
server at all. The one op that needs code shows how the two modes mix.

```
packages/recipe   the contract (`@upstash-example/recipe`, client-safe) +
                  `@upstash-example/recipe/backend`: implement(contract, { redis: { query } })
packages/sdk      publishable typed client: createClient(contract, http({ auth }))
packages/cli      publishable `upstash-redis` binary (+ generated agent skill)
packages/mcp      publishable `upstash-redis-mcp` stdio binary
apps/app          React console + toFetchHandler(backend) at /api + createMcpHandler(backend) at /mcp
stub.mjs          a stand-in for api.upstash.com, to run everything offline
```

## Who calls what

| surface                     | transport          | descriptor ops (list, get, create, rename, delete)       | `query`                         |
| --------------------------- | ------------------ | -------------------------------------------------------- | ------------------------------- |
| SDK                         | `http({ auth })`   | straight to api.upstash.com                              | not available (NOT_IMPLEMENTED) |
| CLI, stdio MCP              | `local(backend)`   | straight to api.upstash.com (proxied in process)         | runs in process                 |
| app (console, REST, `/mcp`) | the hosted backend | proxied as the caller, or as the server's `.env` account | runs on the server              |

`query` runs a Redis command with `@upstash/redis`: it calls `get` through the
backend to read the database's REST endpoint and token, then talks to the
database. Tokens never reach the browser.

Auth is RFC 7617 Basic, account email + developer API key, from
`UPSTASH_EMAIL` / `UPSTASH_API_KEY` (env or a `.env` next to each runnable
package). `--team` / `UPSTASH_TEAM_ID` sends the `Upstash-Team-Id` scope.

## Run it

```bash
pnpm install && pnpm build                         # build the onedef packages once
node examples/upstash/stub.mjs &                   # optional: offline upstream on :4010
export UPSTASH_API_URL=http://localhost:4010 UPSTASH_EMAIL=me@example.com UPSTASH_API_KEY=key
```

| surface                         | command                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| console + API + `/mcp` on :3000 | `pnpm --filter @upstash-example/app dev` (or `build && start`)                                  |
| CLI                             | `pnpm --filter @upstash-example/cli cli redis list` · `… redis query db_1 --command '["PING"]'` |
| MCP over stdio                  | `pnpm --filter @upstash-example/mcp verify` · `… inspect`                                       |
| agent skill                     | `pnpm --filter @upstash-example/cli skill`                                                      |
| build an artifact               | `pnpm --filter @upstash-example/<sdk\|cli\|mcp> build`                                          |

> Without `UPSTASH_API_URL` these hit your real account: create and delete are real.

## What else it shows

- **Real endpoints, verified against the official CLI**: list is
  `/v2/redis/databases` (plural), get `/v2/redis/database/{id}`, rename
  `/v2/redis/rename/{id}`.
- **A collection mutation**: `create` has no id in the client's input type,
  the CLI args, the MCP tool schema or the route.
- **Response shaping**: the upstream returns credentials even in list
  responses; `select` projects them away for every surface.
- **Publishable artifacts without publishing the recipe**: the SDK, CLI and
  MCP builds bundle the contract; remove `"private": true` to publish.
