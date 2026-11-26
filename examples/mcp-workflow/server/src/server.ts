/**
 * The MCP server: an ordinary MCP SDK server with three workflows on it, each as
 * two tools (`write_guide_*`, `deploy_*`, `release_*`). Nothing
 * here is onedef beyond `registerWorkflowTool`, which works on any `McpServer`.
 *
 * Runs must outlive the request that started them. Each request gets a fresh
 * `McpServer`, as the SDK's handler expects, so runs live in a store shared
 * across requests: Upstash Redis when it is configured (what a serverless
 * deploy needs), process memory otherwise.
 */
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import { memoryRunStore, type RunStore } from '@onedef/mcp-elicitation-workflow'
import { registerWorkflowTool } from '@onedef/mcp-elicitation-workflow/mcp'
import { redisRunStore } from '@onedef/mcp-elicitation-workflow/redis'
import { Redis } from '@upstash/redis'
import { deploy, release } from './deploy.js'
import { writeGuide } from './guide.js'

export { deploy, release } from './deploy.js'
export { writeGuide } from './guide.js'

export function defaultRunStore(): RunStore {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  return url && token ? redisRunStore(new Redis({ url, token }), { prefix: 'guides:' }) : memoryRunStore()
}

/** One MCP server with the workflows: one the agent works through, two that ask the user. */
export function guideServer(runStore: RunStore): McpServer {
  const server = new McpServer({ name: 'guides', version: '1.0.0' })
  registerWorkflowTool(server, 'write_guide', { runStore }, writeGuide)
  registerWorkflowTool(server, 'deploy', { runStore }, deploy)
  registerWorkflowTool(server, 'release', { runStore }, release)
  return server
}

/** The Streamable HTTP endpoint, as a fetch handler: `(request) => Promise<Response>`. */
export function guideHandler(runStore: RunStore = defaultRunStore()): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(() => guideServer(runStore))
  return (request) => handler.fetch(request)
}
