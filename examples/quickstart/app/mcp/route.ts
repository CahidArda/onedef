// The MCP server, at /mcp
import { createMcpHandler } from '@onedef/mcp'
import { backend } from '@/lib/backend'

const handler = createMcpHandler(backend)
export { handler as GET, handler as POST, handler as DELETE }
