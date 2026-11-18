import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { createWorkflow, RunError, workflowRuns, memoryRunStore, type RunStore } from '../src/index.js'
import { registerWorkflowTool } from '../src/mcp.js'
import { redisRunStore, type RunRedisClient } from '../src/redis.js'

// --- a workflow: outline a guide, then write each section -------------------

const effects = { saves: 0 }

const writeGuide = createWorkflow({
  id: 'write-guide',
  agentInput: true,
  description: 'Write a short guide on a topic.',
  input: z.object({ topic: z.string() }),
}).handler(async (ctx) => {
  const outline = await ctx.elicitAgentInput('outline', {
    schema: z.object({ sections: z.array(z.string()).min(2).max(4) }),
    instructions: 'Propose 2 to 4 section titles for a short guide on the topic.',
    data: { topic: ctx.input.topic },
  })
  const sections: { title: string; body: string }[] = []
  for (const [i, title] of outline.sections.entries()) {
    const { body } = await ctx.elicitAgentInput(`section-${i + 1}`, {
      schema: z.object({ body: z.string().min(10) }),
      instructions: 'Write this section in 2 to 3 sentences.',
      data: { title },
    })
    sections.push({ title, body })
  }
  await ctx.step('save', () => void effects.saves++)
  return { topic: ctx.input.topic, sections }
})

/** The slice of Redis the run store uses, in memory. */
function fakeRedis(): RunRedisClient {
  const strings = new Map<string, string>()
  const lists = new Map<string, string[]>()
  return {
    get: async (key) => strings.get(key) ?? null,
    set: async (key, value) => void strings.set(key, value),
    del: async (...keys) => keys.filter((key) => strings.delete(key) || lists.delete(key)).length,
    lrange: async (key, start, end) => (lists.get(key) ?? []).slice(start, end === -1 ? undefined : end + 1),
    eval: async (_script, [key], [expected, event]) => {
      const list = lists.get(key!) ?? []
      if (list.length !== Number(expected)) return 0
      list.push(String(event))
      lists.set(key!, list)
      return 1
    },
  }
}

const stores: [string, () => RunStore][] = [
  ['memory', memoryRunStore],
  ['redis', () => redisRunStore(fakeRedis())],
]

for (const [label, make] of stores) {
  test(`${label}: an agent drives a run with start/next; a rejected answer does not move it`, async () => {
    effects.saves = 0
    const runStore = make()
    // a fresh driver per call, as separate serverless requests would have
    const runs = () => workflowRuns(writeGuide, { runStore })

    const started = await runs().start({ topic: 'tea' })
    assert.equal(started.status, 'waiting')
    assert.equal(started.waitingFor?.name, 'outline')
    assert.deepEqual((started.waitingFor as any)?.data, { topic: 'tea' })
    assert.equal((started.waitingFor as any)?.schema?.type, 'object')
    const { runId } = started

    assert.deepEqual(await runs().next(runId), started, 'no payload: the same step again')

    await assert.rejects(runs().next(runId, { sections: ['only one'] }), (error: RunError) => {
      assert.equal(error.code, 'INVALID_INPUT')
      assert.match(error.message, /outline.*rejected.*did not move/)
      return true
    })
    assert.equal((await runs().next(runId)).waitingFor?.name, 'outline')

    const s1 = await runs().next(runId, { sections: ['Brewing', 'Serving'] })
    assert.deepEqual((s1.waitingFor as any)?.data, { title: 'Brewing' })
    const s2 = await runs().next(runId, { body: 'Steep for three minutes.' })
    assert.equal(s2.waitingFor?.name, 'section-2')
    const done = await runs().next(runId, { body: 'Serve it warm, without milk.' })
    assert.equal(done.status, 'done')
    assert.deepEqual(done.output, {
      topic: 'tea',
      sections: [
        { title: 'Brewing', body: 'Steep for three minutes.' },
        { title: 'Serving', body: 'Serve it warm, without milk.' },
      ],
    })
    assert.equal(effects.saves, 1, 'steps ran once across all the calls')
    assert.equal((await runs().next(runId, { body: 'late' })).status, 'done', 'a finished run keeps its result')
    await assert.rejects(runs().next('nope'), (error: RunError) => error.code === 'NOT_FOUND')
  })
}

test('headless: an agent question nobody can answer fails the run, instead of hanging', async () => {
  const state = await workflowRuns(writeGuide, { runStore: memoryRunStore() }).start(
    { topic: 'tea' },
    { headless: true },
  )
  assert.equal(state.status, 'failed')
  assert.match(state.error?.message ?? '', /Nobody can answer "outline": this run is headless/)
})

test('headless: branch on ctx.headless to do the work another way', async () => {
  const outline = createWorkflow({ id: 'outline', input: z.object({ topic: z.string() }), agentInput: true }).handler(async (ctx) => {
    const schema = z.object({ sections: z.array(z.string()).min(2) })
    return ctx.headless
      ? ctx.step('outline', () => ({ sections: [`What ${ctx.input.topic} is`, `Using ${ctx.input.topic}`] }))
      : ctx.elicitAgentInput('outline', { schema, data: { topic: ctx.input.topic } })
  })
  const runs = workflowRuns(outline, { runStore: memoryRunStore() })
  const headless = await runs.start({ topic: 'tea' }, { headless: true })
  assert.deepEqual(headless, {
    runId: headless.runId,
    status: 'done',
    output: { sections: ['What tea is', 'Using tea'] },
  })
  const driven = await runs.start({ topic: 'tea' })
  assert.equal(driven.waitingFor?.kind, 'agent', 'the same workflow, started normally, asks the agent')
})

test('registerWorkflowTool: config works like registerTool config, overriding the workflow', async () => {
  const server = new McpServer({ name: 'guides', version: '1.0.0' })
  registerWorkflowTool(
    server,
    'guide',
    {
      title: 'Write a guide',
      description: 'Writes a guide.',
      inputSchema: z.object({ topic: z.string(), audience: z.string().optional() }),
      annotations: { openWorldHint: false },
      runStore: memoryRunStore(),
    },
    writeGuide,
  )
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'agent', version: '1.0.0' })
  await client.connect(b)
  const tool = (await client.listTools()).tools.find((t) => t.name === 'guide')!
  assert.equal(tool.title, 'Write a guide')
  assert.match(tool.description ?? '', /^Writes a guide\. This starts a run/)
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), ['topic', 'audience'])
  assert.equal(tool.annotations?.openWorldHint, false)
  await client.close()
})

test('registerWorkflowTool: an agentInput workflow is two MCP tools, named and described from the workflow', async () => {
  const server = new McpServer({ name: 'guides', version: '1.0.0' })
  registerWorkflowTool(server, 'write_guide', { runStore: memoryRunStore() }, writeGuide)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'agent', version: '1.0.0' })
  await client.connect(b)

  const { tools } = await client.listTools()
  const start = tools.find((tool) => tool.name === 'write_guide')!
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['write_guide', 'write_guide_next'],
  )
  assert.match(start.description ?? '', /^Write a short guide on a topic\. This starts a run/)
  assert.deepEqual(start.inputSchema.required, ['topic'])

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    return result.isError
      ? { error: (result.content as { text: string }[])[0]!.text }
      : (result.structuredContent as any)
  }
  const bad = await call('write_guide', {})
  assert.match(bad.error, /^INVALID_INPUT/)

  let state = await call('write_guide', { topic: 'tea' })
  const rejected = await call('write_guide_next', { runId: state.runId, payload: { sections: [] } })
  assert.match(rejected.error, /^INVALID_INPUT: Answer to "outline" rejected/)
  state = await call('write_guide_next', { runId: state.runId, payload: { sections: ['A', 'B'] } })
  state = await call('write_guide_next', { runId: state.runId, payload: { body: 'Section A, long enough.' } })
  state = await call('write_guide_next', { runId: state.runId, payload: { body: 'Section B, long enough.' } })
  assert.equal(state.status, 'done')
  assert.equal(state.output.sections.length, 2)
  await client.close()
})

test('a step that throws fails the run, with the reason, headless or not', async () => {
  const broken = createWorkflow({ id: 'broken' }).handler(async (ctx) =>
    ctx.step('load', (): string => {
      throw new Error('the source is down')
    }),
  )
  const runs = workflowRuns(broken, { runStore: memoryRunStore() })
  const state = await runs.start({})
  assert.equal(state.status, 'failed')
  assert.match(state.error?.message ?? '', /the source is down/)
  const headless = await runs.start({}, { headless: true })
  assert.equal(headless.status, 'failed')
  assert.match(headless.error?.message ?? '', /the source is down/)
})

// --- agentInput: one tool unless the workflow asks the agent ---------------------

test('registerWorkflowTool: a workflow that only asks the user is one MCP tool', async () => {
  const confirm = createWorkflow({ id: 'confirm', description: 'Confirm something.' }).handler(async (ctx) => {
    const answer = await ctx.elicitHumanInput({
      message: 'Go?',
      requestedSchema: { type: 'object', properties: { go: { type: 'boolean' } }, required: ['go'] },
    })
    return answer.action
  })
  const server = new McpServer({ name: 'confirms', version: '1.0.0' })
  registerWorkflowTool(server, 'confirm', { runStore: memoryRunStore() }, confirm)
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'agent', version: '1.0.0' })
  await client.connect(b)

  const { tools } = await client.listTools()
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['confirm'],
  )
  assert.doesNotMatch(tools[0]!.description ?? '', /_next/)
  await client.close()
})

test('agentInput defaults to false: ctx.elicitAgentInput is a type error, and a clear error at runtime', async () => {
  const userOnly = createWorkflow({ id: 'user-only' }).handler(async (ctx) =>
    // @ts-expect-error: no agentInput: true, so there is no elicitAgentInput
    ctx.elicitAgentInput('x', { schema: z.object({ a: z.string() }) }),
  )
  const state = await workflowRuns(userOnly, { runStore: memoryRunStore() }).start({})
  assert.equal(state.status, 'failed')
  assert.match(state.error?.message ?? '', /needs `agentInput: true` on createWorkflow/)

  // and with the flag, it is there and typed
  createWorkflow({ id: 'asks-agent', agentInput: true }).handler(async (ctx) => {
    const { a } = await ctx.elicitAgentInput('x', { schema: z.object({ a: z.string() }) })
    const typed: string = a
    return typed
  })
})
