import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

// Spawn the stdio server with the official client, list its tools and call
// one. Needs the app running (`pnpm --filter @example/basic-app dev`).
const client = new Client({ name: 'verify', version: '1.0.0' })
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', new URL('main.ts', import.meta.url).pathname],
    env: { ...process.env, ACME_API_KEY: 'test-key' } as Record<string, string>,
  }),
)
for (const tool of (await client.listTools()).tools) {
  console.log(tool.name.padEnd(24), tool.annotations?.destructiveHint ? '[destructive]' : '')
}
const list = await client.callTool({ name: 'redis_list', arguments: {} })
console.log('redis_list →', JSON.stringify(list.structuredContent))
await client.close()
