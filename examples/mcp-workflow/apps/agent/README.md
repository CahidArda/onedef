# workflow-agent: evals for the guide workflow

An [eve](https://www.npmjs.com/package/eve) agent whose only tools are the example MCP
server's (`../server`). Its eval checks that the agent drives the workflow over MCP from start
to `done`. The eval config starts the server itself.

```bash
pnpm eval
```

The agent's model is eve's `mockModel`, scripted in `agent/lib/scripted.ts`, so the eval is
deterministic and needs no API key. Needs Node 24 or later. `GUIDES_MCP_URL=https://…/mcp`
evaluates a deployed server instead of the local one.
