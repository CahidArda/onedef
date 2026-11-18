import { defineMcpClientConnection } from "eve/connections";

// The example MCP server (apps/server). evals/evals.config.ts starts it on this
// port for eval runs; point GUIDES_MCP_URL at a deployment to evaluate that instead.
export default defineMcpClientConnection({
  url: process.env.GUIDES_MCP_URL?.trim() || "http://localhost:3333/mcp",
  description: "Guides: a workflow that writes a short guide on a topic, which you drive step by step.",
});
