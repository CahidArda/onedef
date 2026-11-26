/**
 * The baseline: the same deploy with the MCP SDK's own elicitation (protocol
 * 2026-07-28). The tool returns `input_required`, the client asks the user and
 * calls the tool again with the answer, so the code before the question (the
 * build) runs again on every round. This is the SDK's documented pattern.
 */
import { appendFileSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { acceptedContent, createMcpHandler, inputRequired, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

let builds = 0
const log = (line: string) => {
  if (process.env.DEPLOY_LOG) appendFileSync(process.env.DEPLOY_LOG, `${new Date().toISOString()} ${line}\n`)
}

const factory = () => {
  const server = new McpServer({ name: 'plain', version: '1.0.0' })
  server.registerTool(
    'deploy',
    {
      description: 'Build the app and deploy it to an environment, after the user confirms.',
      inputSchema: z.object({ env: z.string() }),
    },
    async ({ env }, ctx) => {
      builds++ // the expensive part, before the question
      log(`plain deploy: BUILD ran (total ${builds}) env=${env}`)
      const answer = acceptedContent<{ confirm: boolean }>(ctx.mcpReq.inputResponses, 'confirm')
      if (!answer) {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Deploy build-${builds} to ${env}?`,
              requestedSchema: {
                type: 'object',
                properties: { confirm: { type: 'boolean', title: 'Deploy?' } },
                required: ['confirm'],
              },
            }),
          },
        })
      }
      if (!answer.confirm) return { content: [{ type: 'text', text: 'not deployed' }] }
      log(`plain deploy: SHIPPED build-${builds} to ${env}`)
      return { content: [{ type: 'text', text: `deployed build-${builds} to ${env}` }] }
    },
  )
  return server
}

const handler = createMcpHandler(factory)
const port = Number(process.env.PORT ?? 3334)
serve({ port, fetch: (request) => handler.fetch(request) })
console.log(`plain MCP server at http://localhost:${port}/mcp`)
