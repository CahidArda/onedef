import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient, isApiError, local } from 'onedef'
import { connect, hostContext, launch, mcpApp, onToolResult, openLink, type HostPort } from '../src/app.js'
import { toMcpTools, toolError, toolResult } from '../src/index.js'
import { backend, contract } from './fixture.js'

type Message = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: any; result?: any }

const tools = toMcpTools(contract, { transport: local(backend) })

/**
 * A fake MCP host: an EventTarget standing in for `window.parent`. It answers
 * the handshake, runs `tools/call` through the real tool definitions, and
 * sends the launch tool's input and result after `initialized`, like a host does.
 */
class FakeHost extends EventTarget {
  received: Message[] = []
  port: HostPort = {
    send: (message) => queueMicrotask(() => this.handle(message as Message)),
    listen: (onMessage) => this.addEventListener('message', (event) => onMessage((event as MessageEvent).data)),
  }

  constructor(private launchWith?: { tool: string; arguments: Record<string, unknown> }) {
    super()
  }

  post(message: Message) {
    this.dispatchEvent(new MessageEvent('message', { data: message }))
  }

  async handle(message: Message) {
    this.received.push(message)
    const reply = (result: unknown) => this.post({ jsonrpc: '2.0', id: message.id!, result })
    switch (message.method) {
      case 'ui/initialize':
        return reply({
          protocolVersion: '2026-01-26',
          hostInfo: { name: 'fake', version: '1' },
          hostCapabilities: {},
          hostContext: {
            theme: 'dark',
            displayMode: 'inline',
            ...(this.launchWith ? { toolInfo: { tool: { name: this.launchWith.tool } } } : {}),
          },
        })
      case 'ui/notifications/initialized': {
        if (!this.launchWith) return
        this.post({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-input',
          params: { arguments: this.launchWith.arguments },
        })
        const tool = tools.find((t) => t.name === this.launchWith!.tool)!
        const result = await tool.handler(this.launchWith.arguments, {}).then(toolResult, toolError)
        return this.post({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: result })
      }
      case 'tools/call': {
        const tool = tools.find((t) => t.name === message.params.name)!
        return reply(await tool.handler(message.params.arguments, {}).then(toolResult, toolError))
      }
      case 'ui/open-link':
        return reply({})
    }
  }
}

const marker = globalThis as { __ONEDEF_MCP_APP__?: unknown }

test('outside an MCP App: mcpApp() is undefined and launch() resolves undefined', async () => {
  delete marker.__ONEDEF_MCP_APP__
  assert.equal(mcpApp(), undefined)
  assert.equal(await launch(contract), undefined)
  assert.equal(hostContext(), undefined)
})

test('calls round-trip as tool calls; arrays unwrap; errors are ApiErrors', async () => {
  marker.__ONEDEF_MCP_APP__ = { v: 1 }
  const host = new FakeHost()
  connect(host.port)
  const client = createClient(contract, mcpApp()!)

  assert.deepEqual(await client.songs.get({ slug: 'a' }), { slug: 'a', title: 'A' })
  assert.deepEqual(await client.songs.list(), [{ slug: 'a', title: 'A' }])
  assert.deepEqual(await client.songs.create({ title: 'Hey' }), { slug: 'hey', title: 'Hey' })
  assert.equal(await client.songs.remove({ slug: 'a' }), undefined)

  await assert.rejects(client.songs.get({ slug: 'zz' }), (error) => {
    assert.ok(isApiError(error))
    assert.equal(error.code, 'NOT_FOUND')
    assert.equal(error.status, 404)
    assert.equal(error.message, 'No lesson "zz"')
    return true
  })

  const methods = host.received.map((message) => message.method)
  assert.deepEqual(methods.slice(0, 3), ['ui/initialize', 'ui/notifications/initialized', 'tools/call'])
  assert.equal(host.received[0]!.params.protocolVersion, '2026-01-26')
  assert.deepEqual(host.received[2]!.params, { name: 'songs_get', arguments: { slug: 'a' } })
  assert.equal(hostContext()?.theme, 'dark')
})

test('launch() names the tool call that opened the app, with its input and result', async () => {
  marker.__ONEDEF_MCP_APP__ = { v: 1 }
  const host = new FakeHost({ tool: 'songs_get', arguments: { slug: 'a' } })
  connect(host.port)
  const results: unknown[] = []
  onToolResult((result) => results.push(result))

  const opened = await launch(contract)
  assert.ok(opened)
  assert.equal(opened.service, 'songs')
  assert.equal(opened.op, 'get')
  assert.deepEqual(opened.input, { slug: 'a' })
  if (opened.op === 'get') {
    const slug: string = opened.input.slug // typed by the contract
    void slug
  }
  await new Promise((resolve) => setTimeout(resolve, 10))
  assert.deepEqual(results, [{ slug: 'a', title: 'A' }])
  assert.deepEqual((await launch(contract))?.result, { slug: 'a', title: 'A' })
})

test('host requests are answered; host helpers go through the host; timeouts fail as UNAVAILABLE', async () => {
  marker.__ONEDEF_MCP_APP__ = { v: 1 }
  const host = new FakeHost()
  connect(host.port)
  await openLink('https://example.com')
  assert.deepEqual(host.received.at(-1)!.params, { url: 'https://example.com' })

  const answers: Message[] = []
  host.port.send = (message) => void answers.push(message as Message)
  host.post({ jsonrpc: '2.0', id: 'td', method: 'ui/resource-teardown', params: {} })
  assert.deepEqual(answers, [{ jsonrpc: '2.0', id: 'td', result: {} }])

  const silent: HostPort = { send: () => {}, listen: () => {} }
  connect(silent, { timeout: 20 })
  await assert.rejects(createClient(contract, mcpApp()!).songs.list(), (error) => {
    assert.ok(isApiError(error))
    assert.equal(error.code, 'UNAVAILABLE')
    return true
  })
})
