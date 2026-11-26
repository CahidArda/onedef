# @example/basic-mcp

MCP over stdio, for agents that launch a local subprocess. It forwards every tool call to
the app's backend over RPC (`serveMcpStdio(contract, { transport: rpc({ url }) })`), so it
ships no handler code and sees the same data as the web app. Remote agents use the app's
`/mcp` (Streamable HTTP) instead.

```bash
pnpm stdio      # run the server
pnpm inspect    # MCP Inspector against it
pnpm verify     # spawn it with the official client: list tools, call redis_list
```

From the repo root: `pnpm --filter @example/basic-mcp verify`. Needs the app running
(`pnpm --filter @example/basic-app dev`).

| variable | meaning |
| --- | --- |
| `ACME_API_URL` | backend (default `http://localhost:3000/api`) |
| `ACME_API_KEY` | API key the calls are made with |
| `ACME_TEAM` | team the server is bound to |

Docs: [MCP server](https://onedef.cahidarda.com/docs/serve/mcp)
