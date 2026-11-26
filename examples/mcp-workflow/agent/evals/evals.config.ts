import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { guideHandler } from "@example/mcp-workflow-server";
import { memoryRunStore } from "@onedef/mcp-elicitation-workflow";
import { defineEvalConfig } from "eve/evals";

// The MCP server the agent drives, started for the run on the port
// agent/connections/guides.ts points at. Skipped when GUIDES_MCP_URL targets
// a deployed server instead.
export default defineEvalConfig({
  async setup() {
    if (process.env.GUIDES_MCP_URL) return {};
    const server = serve({ port: 3333, fetch: guideHandler(memoryRunStore()) });
    await new Promise((resolve) => server.once("listening", resolve));
    return { server, port: (server.address() as AddressInfo).port };
  },
  async teardown(context) {
    await new Promise((resolve) => (context?.server ? context.server.close(resolve) : resolve(undefined)));
  },
});
