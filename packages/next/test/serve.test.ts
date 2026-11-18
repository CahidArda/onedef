import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMcpHandler } from '@onedef/mcp'
import type { Backend } from 'onedef'
import { serveMcpApp } from '../src/server.js'
import type { contract } from './fixture/contract.js'

// Compile-time only: `tools` are checked against the contract where the app is
// handed to createMcpHandler, even though serveMcpApp() never sees the contract.
export const _typed = (backend: Backend<typeof contract>) => {
  createMcpHandler(backend, { app: serveMcpApp() })
  createMcpHandler(backend, { app: serveMcpApp({ tools: ['songs.get'] }) })
  // @ts-expect-error — songs has no op "nope"
  createMcpHandler(backend, { app: serveMcpApp({ tools: ['songs.nope'] }) })
}

test('serveMcpApp keeps the tools it is given', () => {
  assert.deepEqual(serveMcpApp({ tools: ['songs.get'] }).tools, ['songs.get'])
})
