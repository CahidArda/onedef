// Serve the MCP endpoint at http://localhost:$PORT/mcp (default 3333).
import { serve } from '@hono/node-server'
import { guideHandler } from './server.js'

const port = Number(process.env.PORT ?? 3333)
const mcp = guideHandler()
serve({
  port,
  fetch: (request) =>
    new URL(request.url).pathname === '/mcp' ? mcp(request) : new Response('Not found', { status: 404 }),
})
console.log(`MCP server at http://localhost:${port}/mcp`)
