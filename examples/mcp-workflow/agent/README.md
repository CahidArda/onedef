# @example/mcp-workflow-agent

An [eve](https://www.npmjs.com/package/eve) agent whose only tools are the example MCP
server's ([`../server`](../server)). Its eval checks that the agent drives the write-guide
workflow over MCP from start to `done`. The eval config starts the server itself.

```
agent/agent.ts               the agent
agent/connections/guides.ts  the MCP connection to the server
agent/lib/scripted.ts        the scripted model: deterministic, no API key
evals/                       the eval and its config
```

```bash
pnpm eval                                          # from this folder
pnpm --filter @example/mcp-workflow-agent eval     # from the repo root
```

Needs Node 24 or later. `GUIDES_MCP_URL=https://…/mcp` evaluates a deployed server instead
of the local one.

Docs: [Asking the agent](https://onedef.cahidarda.com/docs/mcp-elicitation-workflow/asking-the-agent)
