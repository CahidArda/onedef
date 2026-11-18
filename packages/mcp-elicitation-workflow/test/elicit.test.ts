import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/client'
import { acceptedContent, InMemoryTransport, inputRequired, McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { createWorkflow, memoryRunStore, RunError, workflowRuns, type ElicitResult } from '../src/index.js'
import { registerWorkflowTool } from '../src/mcp.js'

type Counts = { builds: number; ships: number }

/** A deploy that builds, asks a human with TanStack's own `ctx.approve`, then ships. */
function deployWorkflow(counts: Counts) {
  return createWorkflow({
    id: 'deploy',
    description: 'Build and deploy.',
    input: z.object({ env: z.string() }),
  }).handler(async (ctx) => {
    const build = await ctx.step('build', () => `build-${++counts.builds}`)
    const { approved, feedback } = await ctx.approve({ title: `Deploy ${build} to ${ctx.input.env}?` })
    if (!approved) return { deployed: false, build, feedback }
    await ctx.step('ship', () => void counts.ships++)
    return { deployed: true, build, feedback }
  })
}

const releaseForm = {
  type: 'object',
  properties: {
    channel: { type: 'string', enum: ['stable', 'beta'], title: 'Channel' },
    notes: { type: 'string', title: 'Release notes' },
  },
  required: ['channel'],
}

/** A release that builds, then asks a human to fill a form with `ctx.elicitHumanInput`. */
function releaseWorkflow(counts: Counts) {
  return createWorkflow({ id: 'release', input: z.object({ version: z.string() }) }).handler(async (ctx) => {
    const build = await ctx.step('build', () => `build-${++counts.builds}`)
    const answer = await ctx.elicitHumanInput({
      message: `Release ${ctx.input.version} (${build})?`,
      requestedSchema: releaseForm,
    })
    if (answer.action !== 'accept') return { released: false, build, action: answer.action }
    await ctx.step('ship', () => void counts.ships++)
    return { released: true, build, ...answer.content }
  })
}

async function connect(server: McpServer, answer: (params: { message: string; requestedSchema: any }) => ElicitResult) {
  const asked: string[] = []
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  const client = new Client({ name: 'user', version: '1.0.0' }, { capabilities: { elicitation: { form: {} } } })
  client.setRequestHandler('elicitation/create', async (request) => {
    const params = (request as { params: { message: string; requestedSchema: unknown } }).params
    asked.push(params.message)
    return answer(params as never) as never
  })
  await client.connect(b)
  return { client, asked }
}

const output = (result: { structuredContent?: unknown }) => (result.structuredContent as { output: unknown }).output

test('the MCP SDK way: the tool runs again from the top after the user answers', async () => {
  let builds = 0
  const confirm = { type: 'object', properties: { confirm: { type: 'boolean' } }, required: ['confirm'] }
  const server = new McpServer({ name: 'plain', version: '1.0.0' })
  server.registerTool('deploy', { inputSchema: z.object({ env: z.string() }) }, async ({ env }, ctx) => {
    builds++ // the expensive part before the question
    const answer = acceptedContent<{ confirm: boolean }>(ctx.mcpReq.inputResponses, 'confirm')
    if (!answer) {
      return inputRequired({
        inputRequests: {
          confirm: inputRequired.elicit({ message: `Deploy to ${env}?`, requestedSchema: confirm as never }),
        },
      })
    }
    return { content: [{ type: 'text', text: `deployed after ${builds} builds` }] }
  })
  const { client, asked } = await connect(server, () => ({ action: 'accept', content: { confirm: true } }))
  const result = await client.callTool({ name: 'deploy', arguments: { env: 'prod' } })
  assert.equal(asked.length, 1)
  assert.equal(builds, 2, 'built twice for one deploy')
  assert.match((result.content as { text: string }[])[0]!.text, /after 2 builds/)
  await client.close()
})

test('ctx.approve over MCP: a native form; the build runs once', async () => {
  const counts = { builds: 0, ships: 0 }
  const server = new McpServer({ name: 'workflow', version: '1.0.0' })
  registerWorkflowTool(server, 'deploy', { runStore: memoryRunStore() }, deployWorkflow(counts))
  let form: any
  const { client, asked } = await connect(server, (params) => {
    form = params.requestedSchema
    return { action: 'accept', content: { approved: true, feedback: 'ship it' } }
  })
  const result = await client.callTool({ name: 'deploy', arguments: { env: 'prod' } })
  assert.deepEqual(asked, ['Deploy build-1 to prod?'])
  assert.deepEqual(Object.keys(form.properties), ['approved', 'feedback'])
  assert.deepEqual(form.required, ['approved'])
  assert.deepEqual(counts, { builds: 1, ships: 1 }, 'the retried call replayed the build')
  assert.deepEqual(output(result), { deployed: true, build: 'build-1', feedback: 'ship it' })
  await client.close()
})

test('ctx.approve over MCP: declining or dismissing the form does not approve', async () => {
  for (const [action, feedback] of [
    ['decline', 'Declined'],
    ['cancel', 'Cancelled'],
  ] as const) {
    const counts = { builds: 0, ships: 0 }
    const server = new McpServer({ name: 'workflow', version: '1.0.0' })
    registerWorkflowTool(server, 'deploy', { runStore: memoryRunStore() }, deployWorkflow(counts))
    const { client, asked } = await connect(server, () => ({ action }))
    const result = await client.callTool({ name: 'deploy', arguments: { env: 'prod' } })
    assert.equal(asked.length, 1, 'asked once, not in a loop')
    assert.deepEqual(output(result), { deployed: false, build: 'build-1', feedback })
    assert.deepEqual(counts, { builds: 1, ships: 0 })
    await client.close()
  }
})

test('ctx.elicitHumanInput over MCP: the form the workflow asked for; the build runs once', async () => {
  const counts = { builds: 0, ships: 0 }
  const server = new McpServer({ name: 'workflow', version: '1.0.0' })
  registerWorkflowTool(server, 'release', { runStore: memoryRunStore() }, releaseWorkflow(counts))
  let form: any
  const { client } = await connect(server, (params) => {
    form = params.requestedSchema
    return { action: 'accept', content: { channel: 'beta', notes: 'Faster builds' } }
  })
  const result = await client.callTool({ name: 'release', arguments: { version: '2.0.0' } })
  assert.deepEqual(form, releaseForm)
  assert.deepEqual(output(result), { released: true, build: 'build-1', channel: 'beta', notes: 'Faster builds' })
  assert.deepEqual(counts, { builds: 1, ships: 1 })
  await client.close()
})

test('without MCP: start, then answer with next (approval and form)', async () => {
  const counts = { builds: 0, ships: 0 }
  const deploys = workflowRuns(deployWorkflow(counts), { runStore: memoryRunStore() })
  const waiting = await deploys.start({ env: 'prod' })
  assert.equal(waiting.waitingFor?.kind, 'approval')
  assert.equal((waiting.waitingFor as { title: string }).title, 'Deploy build-1 to prod?')
  await assert.rejects(deploys.next(waiting.runId, { yes: true }), (error: RunError) => error.code === 'INVALID_INPUT')
  const done = await deploys.next(waiting.runId, { approved: true })
  assert.deepEqual(done.output, { deployed: true, build: 'build-1' })

  const releases = workflowRuns(releaseWorkflow(counts), { runStore: memoryRunStore() })
  const asked = await releases.start({ version: '2.0.0' })
  assert.deepEqual(asked.waitingFor, {
    kind: 'human',
    name: 'elicit-1',
    message: 'Release 2.0.0 (build-2)?',
    requestedSchema: releaseForm,
  })
  // a form answer missing a required field is rejected; the run waits at the same question
  await assert.rejects(releases.next(asked.runId, { action: 'accept', content: {} }), (error: RunError) => {
    assert.equal(error.code, 'INVALID_INPUT')
    assert.match(error.message, /content\.channel: required/)
    return true
  })
  const released = await releases.next(asked.runId, { action: 'accept', content: { channel: 'stable' } })
  assert.deepEqual(released.output, { released: true, build: 'build-2', channel: 'stable' })
  assert.deepEqual(counts, { builds: 2, ships: 2 })
})

test('headless: elicitHumanInput is cancelled; ctx.approve still waits, and can be answered', async () => {
  const counts = { builds: 0, ships: 0 }
  const release = await workflowRuns(releaseWorkflow(counts), { runStore: memoryRunStore() }).start(
    { version: '1' },
    { headless: true },
  )
  assert.deepEqual(release.output, { released: false, build: 'build-1', action: 'cancel' })

  const deploys = workflowRuns(deployWorkflow(counts), { runStore: memoryRunStore() })
  const waiting = await deploys.start({ env: 'prod' }, { headless: true })
  assert.equal(waiting.waitingFor?.kind, 'approval')
  const done = await deploys.next(waiting.runId, { approved: false, feedback: 'not today' })
  assert.deepEqual(done.output, { deployed: false, build: 'build-2', feedback: 'not today' })
})
