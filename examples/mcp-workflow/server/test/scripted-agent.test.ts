/**
 * A scripted agent drives the server over real Streamable HTTP, with no model:
 * the deterministic half of the evals, so CI checks the protocol on every push.
 * evals/ (an eve agent) checks that a real model can drive it too.
 */
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { serve, type ServerType } from '@hono/node-server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { memoryRunStore } from '@onedef/mcp-elicitation-workflow'
import { guideHandler } from '../src/server.js'

let server: ServerType
let url: URL

before(async () => {
  const mcp = guideHandler(memoryRunStore())
  server = serve({ port: 0, fetch: mcp })
  await new Promise((resolve) => server.once('listening', resolve))
  url = new URL(`http://localhost:${(server.address() as AddressInfo).port}/mcp`)
})
after(() => server.close())

async function connect() {
  const client = new Client({ name: 'scripted-agent', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(url))
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    const text = (result.content as { text: string }[])[0]?.text ?? ''
    return result.isError ? { error: text } : (result.structuredContent as any)
  }
  return { client, call }
}

/** What a careful agent answers for each step, from what the step shows it. */
function answer(waitingFor: { name: string; data?: any }) {
  if (waitingFor.name === 'plan') return { sections: ['Choosing leaves', 'Brewing', 'Serving'] }
  if (waitingFor.name.startsWith('section-')) {
    return { body: `${waitingFor.data.title} matters: here is how to get it right, step by step, every time.` }
  }
  return { summary: 'A three-part guide to making a good cup of tea.', approved: true }
}

test('the server lists the workflow tools: _next only for the one that asks the agent', async () => {
  const { client } = await connect()
  const { tools } = await client.listTools()
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['write_guide', 'write_guide_next', 'deploy', 'release'],
  )
  assert.match(tools[0]!.description ?? '', /This starts a run/)
  assert.deepEqual(tools[0]!.inputSchema.required, ['topic'])
  await client.close()
})

test('a scripted agent drives a run to the end; a wrong answer is sent back', async () => {
  const { client, call } = await connect()
  let state = await call('write_guide', { topic: 'tea' })
  assert.equal(state.status, 'waiting')
  assert.equal(state.waitingFor.name, 'plan')
  assert.deepEqual(state.waitingFor.data, { topic: 'tea' })

  // too few sections: rejected with the reason, the run stays at "plan"
  const wrong = await call('write_guide_next', { runId: state.runId, payload: { sections: ['Only one'] } })
  assert.match(wrong.error, /^INVALID_INPUT: Answer to "plan" rejected.*sections/)
  assert.equal((await call('write_guide_next', { runId: state.runId })).waitingFor.name, 'plan')

  const seen: string[] = []
  while (state.status === 'waiting') {
    seen.push(state.waitingFor.name)
    state = await call('write_guide_next', { runId: state.runId, payload: answer(state.waitingFor) })
    assert.ok(!state.error, state.error)
  }
  assert.deepEqual(seen, ['plan', 'section-1-of-3', 'section-2-of-3', 'section-3-of-3', 'review'])
  assert.equal(state.status, 'done')
  assert.equal(state.output.topic, 'tea')
  assert.equal(state.output.sections.length, 3)
  assert.ok(state.output.words > 20)
  await client.close()
})

test('every connection sees the same runs (the store is shared, not the server)', async () => {
  const first = await connect()
  const { runId } = await first.call('write_guide', { topic: 'bread' })
  await first.client.close()
  const second = await connect()
  const state = await second.call('write_guide_next', { runId, payload: answer({ name: 'plan' }) })
  assert.equal(state.waitingFor.name, 'section-1-of-3')
  await second.client.close()
})
