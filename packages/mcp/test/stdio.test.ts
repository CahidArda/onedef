import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

test('serveMcpStdio: credentials from env and bound scope reach the backend', async () => {
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', fileURLToPath(new URL('./stdio-server.ts', import.meta.url))],
      env: { ...(process.env as Record<string, string>), ACME_KEY: 'k-123' },
    }),
  )
  try {
    const who = await client.callTool({ name: 'songs_whoami', arguments: {} })
    assert.deepEqual(who.structuredContent, { auth: 'key k-123', team: 'stdio-team' })
  } finally {
    await client.close()
  }
})
