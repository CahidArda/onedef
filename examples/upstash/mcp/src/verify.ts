import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

// Spawn the stdio server with the official client, list its tools and call
// redis list. Point UPSTASH_API_URL at a stub (../../stub.mjs) to run offline.
const client = new Client({ name: 'verify', version: '1.0.0' })
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', new URL('main.ts', import.meta.url).pathname],
    env: { ...process.env } as Record<string, string>,
  }),
)
for (const tool of (await client.listTools()).tools) {
  console.log(tool.name.padEnd(28), tool.annotations?.destructiveHint ? '[destructive]' : '')
}
const list = await client.callTool({ name: 'upstash_redis_list', arguments: {} })
console.log('upstash_redis_list →', list.isError ? list.content : JSON.stringify(list.structuredContent))
await client.close()
