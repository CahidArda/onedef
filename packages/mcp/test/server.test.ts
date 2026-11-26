import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { type Call } from 'onedef'
import { createMcpHandler, injectMarker, protectedResourceMetadata, toMcpTools } from '../src/index.js'
import { backend, contract } from './fixture.js'

const html = '<html><head></head><body>hi</body></html>'

/** A real v2 client talking to the handler in process: its fetch calls the handler directly. */
async function connect(
  handler: (request: Request) => Promise<Response>,
  headers: Record<string, string> = {},
  era: 'legacy' | 'auto' = 'legacy',
) {
  const client = new Client({ name: 'test', version: '0.0.0' }, { versionNegotiation: { mode: era } })
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
    fetch: (url, init) => {
      const request = new Request(url, init)
      for (const [name, value] of Object.entries(headers)) request.headers.set(name, value)
      return handler(request)
    },
  })
  await client.connect(transport)
  return client
}

const handler = createMcpHandler(backend, {
  app: { html, tools: ['songs.get'], csp: { resourceDomains: ['https://i.ytimg.com'] }, prefersBorder: true },
})

test('tools/list: names, schemas, annotations, app meta only on app tools', async () => {
  const client = await connect(handler)
  assert.equal(client.getServerVersion()?.name, 'acme')
  assert.equal(client.getServerVersion()?.version, '1.2.3')
  assert.equal(client.getInstructions(), 'French song lessons.')

  const { tools } = await client.listTools()
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
  assert.deepEqual(Object.keys(byName).sort(), [
    'songs_create',
    'songs_get',
    'songs_list',
    'songs_remove',
    'songs_whoami',
  ])

  const get = byName.songs_get!
  assert.deepEqual(get.inputSchema.required, ['slug'])
  assert.equal((get.inputSchema.properties as Record<string, { type: string }>).slug!.type, 'string')
  assert.match(get.description!, /Call songs_list first/)
  assert.equal(get.outputSchema?.type, 'object')
  assert.deepEqual(get.annotations, { title: 'Get one lesson', readOnlyHint: true, openWorldHint: true })
  assert.deepEqual(get._meta, {
    ui: { resourceUri: 'ui://acme/app.html', visibility: ['model', 'app'] },
    'ui/resourceUri': 'ui://acme/app.html',
  })

  assert.equal(byName.songs_list!.outputSchema, undefined, 'array outputs declare no outputSchema')
  assert.equal(byName.songs_list!._meta, undefined)
  assert.deepEqual(byName.songs_create!.inputSchema.required, ['title'])
  assert.deepEqual(byName.songs_remove!.annotations, {
    title: 'Delete a lesson',
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  })
})

test('tools/call: object result, wrapped array, ApiError, request reaches context()', async () => {
  const client = await connect(handler, { authorization: 'Bearer tok', 'x-team': 't1' })

  const got = await client.callTool({ name: 'songs_get', arguments: { slug: 'a' } })
  assert.deepEqual(got.structuredContent, { slug: 'a', title: 'A' })
  assert.equal(got._meta?.['onedef/wrapped'], undefined)
  assert.deepEqual(JSON.parse((got.content[0] as { text: string }).text), { slug: 'a', title: 'A' })

  const list = await client.callTool({ name: 'songs_list', arguments: {} })
  assert.deepEqual(list.structuredContent, { result: [{ slug: 'a', title: 'A' }] })
  assert.equal(list._meta?.['onedef/wrapped'], true)

  const missing = await client.callTool({ name: 'songs_get', arguments: { slug: 'zz' } })
  assert.equal(missing.isError, true)
  assert.equal((missing.content[0] as { text: string }).text, 'NOT_FOUND: No lesson "zz"')
  assert.deepEqual(missing._meta?.['onedef/error'], { code: 'NOT_FOUND', status: 404 })

  const invalid = await client.callTool({ name: 'songs_create', arguments: { title: '' } })
  assert.equal(invalid.isError, true)
  assert.match((invalid.content[0] as { text: string }).text, /^INVALID_INPUT: /)

  const who = await client.callTool({ name: 'songs_whoami', arguments: {} })
  assert.deepEqual(who.structuredContent, { auth: 'Bearer tok', team: 't1' })
})

test('the 2026 protocol era serves the same tools, results and request', async () => {
  const client = await connect(handler, { authorization: 'Bearer modern' }, 'auto')
  const list = await client.callTool({ name: 'songs_list', arguments: {} })
  assert.deepEqual(list.structuredContent, { result: [{ slug: 'a', title: 'A' }] })
  assert.equal(list._meta?.['onedef/wrapped'], true)
  const who = await client.callTool({ name: 'songs_whoami', arguments: {} })
  assert.deepEqual(who.structuredContent, { auth: 'Bearer modern', team: 'none' })
  const missing = await client.callTool({ name: 'songs_get', arguments: { slug: 'zz' } })
  assert.deepEqual(missing._meta?.['onedef/error'], { code: 'NOT_FOUND', status: 404 })
})

test('resources/read: the app, with marker and csp', async () => {
  const client = await connect(handler)
  const { resources } = await client.listResources()
  assert.deepEqual(
    resources.map((resource) => [resource.uri, resource.mimeType]),
    [['ui://acme/app.html', 'text/html;profile=mcp-app']],
  )
  const { contents } = await client.readResource({ uri: 'ui://acme/app.html' })
  const [content] = contents as unknown as [{ text: string; mimeType: string; _meta: Record<string, unknown> }]
  assert.equal(content.mimeType, 'text/html;profile=mcp-app')
  assert.equal(
    content.text,
    '<html><head><script>window.__ONEDEF_MCP_APP__={v:1}</script></head><body>hi</body></html>',
  )
  assert.deepEqual(content._meta, { ui: { csp: { resourceDomains: ['https://i.ytimg.com'] }, prefersBorder: true } })
})

test('injectMarker without a head, and unknown app tools fail fast', () => {
  assert.equal(injectMarker('<div/>'), '<script>window.__ONEDEF_MCP_APP__={v:1}</script><div/>')
  assert.equal(injectMarker('<HEAD lang="x">'), '<HEAD lang="x"><script>window.__ONEDEF_MCP_APP__={v:1}</script>')
  // a compile error first (checked against the contract), and a runtime one for untyped callers
  // @ts-expect-error — songs has no op "nope"
  assert.throws(() => createMcpHandler(backend, { app: { html, tools: ['songs.nope'] } }), /songs\.nope/)
})

test('auth: 401 with WWW-Authenticate before the SDK, passes when verified', async () => {
  const guarded = createMcpHandler(backend, {
    auth: {
      verify: (request) => request.headers.get('authorization') === 'Bearer good',
      resourceMetadataUrl: (request) => `${new URL(request.url).origin}/.well-known/oauth-protected-resource`,
    },
  })
  const res = await guarded(new Request('http://mcp.test/mcp', { method: 'POST', body: '{}' }))
  assert.equal(res.status, 401)
  assert.equal(
    res.headers.get('www-authenticate'),
    'Bearer resource_metadata="http://mcp.test/.well-known/oauth-protected-resource"',
  )
  assert.equal((await res.json()).error, 'invalid_token')

  const client = await connect(guarded, { authorization: 'Bearer good' })
  const who = await client.callTool({ name: 'songs_whoami', arguments: {} })
  assert.deepEqual(who.structuredContent, { auth: 'Bearer good', team: 'none' })
})

test('protectedResourceMetadata serves RFC 9728 JSON with CORS', async () => {
  const meta = protectedResourceMetadata({
    resource: 'https://app.test/mcp',
    authorizationServers: ['https://auth.test'],
    scopes: ['songs'],
  })
  const res = meta(new Request('https://app.test/.well-known/oauth-protected-resource'))
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.deepEqual(await res.json(), {
    resource: 'https://app.test/mcp',
    authorization_servers: ['https://auth.test'],
    scopes_supported: ['songs'],
    bearer_methods_supported: ['header'],
  })
})

test('forwarding: a contract with a custom transport receives the incoming request', async () => {
  const calls: Call[] = []
  const forward = createMcpHandler(contract, {
    transport: async (call) => {
      calls.push(call)
      return { slug: String(call.input.slug), title: 'remote' }
    },
  })
  const client = await connect(forward, { authorization: 'Bearer user-token' })
  const got = await client.callTool({ name: 'songs_get', arguments: { slug: 'x' } })
  assert.deepEqual(got.structuredContent, { slug: 'x', title: 'remote' })
  const call = calls.find((c) => c.op === 'get')!
  assert.equal(call.service, 'songs')
  assert.deepEqual(call.input, { slug: 'x' })
  assert.equal(call.request?.headers.get('authorization'), 'Bearer user-token')
})

test('explicit scope mode adds scope params and moves them out of the input', async () => {
  const calls: Call[] = []
  const tools = toMcpTools(contract, {
    scopeMode: 'explicit',
    transport: async (call) => void calls.push(call),
  })
  const whoami = tools.find((tool) => tool.name === 'songs_whoami')!
  assert.deepEqual(Object.keys(whoami.inputSchema.properties!), ['team'])
  await whoami.handler({ team: 't9' }, { scope: { team: 'bound' } })
  assert.deepEqual(calls[0]!.input, {})
  assert.deepEqual(calls[0]!.scope, { team: 't9' })
})
