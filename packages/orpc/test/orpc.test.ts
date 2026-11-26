import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import {
  ApiError,
  createClient,
  defineApi,
  defineConfig,
  defineService,
  fail,
  implement,
  mutation,
  query,
} from 'onedef'
import { rpc } from '../src/client.js'
import { generateOpenApi, toFetchHandler, toNextHandlers } from '../src/index.js'

const Song = z.object({ slug: z.string(), title: z.string(), offsetMs: z.number() })

const config = defineConfig({
  name: 'acme',
  description: 'French song lessons.',
  version: '1.2.3',
  scopes: { team: { header: 'X-Team-Id', description: 'The team the call runs in.', required: true } },
  auth: { apiKey: { env: 'ACME_KEY' } },
})

const songs = defineService(config, {
  name: 'songs',
  description: 'Song lessons.',
  id: 'slug',
  ops: {
    list: query({ summary: 'List lessons', output: z.array(Song) }),
    get: query({ on: 'member', summary: 'Get one lesson', output: Song }),
    setOffset: mutation({
      on: 'member',
      summary: 'Set the offset',
      input: z.object({ offsetMs: z.number().int() }),
      output: Song,
    }),
    create: mutation({
      summary: 'Create a lesson',
      input: z.object({ title: z.string().min(1) }),
      output: Song,
      scope: ['team'],
    }),
    remove: mutation({ on: 'member', summary: 'Delete a lesson', destructive: true }),
    whoami: query({ summary: 'Who is calling', output: z.object({ user: z.string(), key: z.string().optional() }) }),
    lyrics: query({
      on: 'member',
      summary: 'Lyrics',
      output: z.object({ text: z.string() }),
      http: { method: 'GET', path: '/lyrics/{id}', errors: { 404: 'NOT_FOUND' } },
    }),
  },
})

const contract = defineApi(config, { songs })

const db = new Map([['tous', { slug: 'tous', title: 'Tous les mêmes', offsetMs: 0 }]])

const backend = implement(contract, {
  context: ({ request, auth }) => ({ user: request?.headers.get('x-user') ?? 'anon', key: auth?.bearer }),
  songs: {
    list: () => [...db.values()],
    get: ({ id }) => db.get(id) ?? fail('NOT_FOUND', `No lesson "${id}"`),
    setOffset: ({ id, input }) => {
      const song = db.get(id) ?? fail('NOT_FOUND', `No lesson "${id}"`)
      song.offsetMs = input.offsetMs
      return song
    },
    create: ({ input, scope }) => ({ slug: `${scope.team}-${input.title}`, title: input.title, offsetMs: 0 }),
    remove: () => undefined,
    whoami: ({ ctx }) => ({ user: ctx.user, ...(ctx.key ? { key: ctx.key } : {}) }),
    lyrics: ({ id }) => ({ text: `lyrics of ${id}` }),
  },
})

const handler = toFetchHandler(backend)
const sent: Request[] = []
const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  sent.push(request)
  return handler(request)
}
const client = createClient(contract, rpc({ url: 'http://test/api', fetch, headers: { 'x-user': 'ada' } }))

test('rpc: typed results through the oRPC handler', async () => {
  const list = await client.songs.list()
  assert.equal(list[0]!.title, 'Tous les mêmes')
  assert.equal((await client.songs.get({ slug: 'tous' })).slug, 'tous')
  assert.equal((await client.songs.setOffset({ slug: 'tous', offsetMs: 120 })).offsetMs, 120)
  assert.equal(await client.songs.remove({ slug: 'tous' }), undefined)
  assert.ok(sent.at(-1)!.url.startsWith('http://test/api/rpc/'))
})

test('rpc: ApiError code and status survive the wire', async () => {
  await assert.rejects(
    client.songs.get({ slug: 'nope' }),
    (e: unknown) => e instanceof ApiError && e.code === 'NOT_FOUND' && e.status === 404 && /nope/.test(e.message),
  )
  await assert.rejects(
    // @ts-expect-error offsetMs must be a number
    client.songs.setOffset({ slug: 'tous', offsetMs: 'soon' }),
    (e: unknown) => e instanceof ApiError && e.code === 'INVALID_INPUT' && e.status === 400,
  )
})

test('rpc: scopes are checked before sending and reach the handler', async () => {
  const before = sent.length
  await assert.rejects(
    client.songs.create({ title: 'x' }),
    (e: unknown) => e instanceof ApiError && /"team" scope/.test(e.message),
  )
  assert.equal(sent.length, before, 'nothing was sent')
  const created = await client.songs.create({ title: 'x' }, { scope: { team: 't1' } })
  assert.equal(created.slug, 't1-x')
  assert.equal(sent.at(-1)!.headers.get('x-team-id'), 't1')
})

test('rpc: context() sees the request headers and credentials', async () => {
  assert.deepEqual(await client.songs.whoami(), { user: 'ada' })
  const keyed = createClient(contract, rpc({ url: 'http://test/api', fetch, auth: () => ({ apiKey: 'k1' }) }))
  assert.deepEqual(await keyed.songs.whoami(), { user: 'anon', key: 'k1' })
  // with no credentials of its own, a call made for a request forwards the caller's
  const forwarding = rpc({ url: 'http://test/api', fetch })
  const caller = new Request('http://app/page', { headers: { authorization: 'Bearer caller' } })
  assert.deepEqual(await forwarding({ service: 'songs', op: 'whoami', input: {}, request: caller }, contract), {
    user: 'anon',
    key: 'caller',
  })
})

test('rpc: a relative url needs a browser', async () => {
  const relative = createClient(contract, rpc({ url: '/api' }))
  await assert.rejects(relative.songs.list(), /relative/)
})

test('REST routes', async () => {
  const list = await handler(new Request('http://test/api/songs'))
  assert.equal(list.status, 200)
  assert.equal(((await list.json()) as unknown[]).length, 1)

  const get = await handler(new Request('http://test/api/songs/tous'))
  assert.equal(((await get.json()) as { slug: string }).slug, 'tous')

  const set = await handler(
    new Request('http://test/api/songs/tous/set-offset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offsetMs: 7 }),
    }),
  )
  assert.equal(set.status, 200)
  assert.equal(((await set.json()) as { offsetMs: number }).offsetMs, 7)

  const missing = await handler(new Request('http://test/api/songs/nope'))
  assert.equal(missing.status, 404)
  assert.equal(((await missing.json()) as { code: string }).code, 'NOT_FOUND')

  const unrouted = await handler(new Request('http://test/api/nothing/here/at/all'))
  assert.equal(unrouted.status, 404)
  assert.deepEqual(Object.keys((await unrouted.json()) as object).sort(), ['code', 'message'])

  const scoped = await handler(
    new Request('http://test/api/songs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-team-id': 't2' },
      body: JSON.stringify({ title: 'y' }),
    }),
  )
  assert.equal(((await scoped.json()) as { slug: string }).slug, 't2-y')
})

test('CORS and Next.js handlers', async () => {
  const { GET, OPTIONS } = toNextHandlers(backend, { cors: true })
  const preflight = await OPTIONS(
    new Request('http://test/api/songs', {
      method: 'OPTIONS',
      headers: { 'access-control-request-headers': 'authorization' },
    }),
  )
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'authorization')
  const res = await GET(new Request('http://test/api/songs'))
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

test('/api/openapi.json', async () => {
  const res = await handler(new Request('http://test/api/openapi.json'))
  const doc = (await res.json()) as any
  assert.equal(doc.info.title, 'acme')
  assert.equal(doc.info.version, '1.2.3')
  assert.deepEqual(Object.keys(doc.paths).sort(), [
    '/api/songs',
    '/api/songs/whoami',
    '/api/songs/{slug}',
    '/api/songs/{slug}/lyrics',
    '/api/songs/{slug}/remove',
    '/api/songs/{slug}/set-offset',
  ])
  const create = doc.paths['/api/songs'].post
  assert.ok(
    create.parameters.some((p: any) => p.name === 'X-Team-Id' && p.in === 'header' && p.required === true),
    'scope header parameter',
  )
  assert.ok(doc.paths['/api/songs/{slug}/remove'].post['x-destructive'])
  assert.ok(doc.paths['/api/songs/{slug}/lyrics'].get.responses['404'])
  assert.ok(
    doc.paths['/api/songs/{slug}/set-offset'].post.parameters.some((p: any) => p.name === 'slug' && p.in === 'path'),
  )
  assert.deepEqual(doc.components.securitySchemes, { apiKey: { type: 'http', scheme: 'bearer' } })
  assert.deepEqual(doc.security, [{ apiKey: [] }])
  assert.deepEqual(doc.tags, [{ name: 'songs', description: 'Song lessons.' }])
})

test('generateOpenApi from a contract alone: security schemes from config.auth', async () => {
  const api = defineApi(
    defineConfig({
      name: 'x',
      auth: { apiKey: { header: 'x-api-key' }, basic: {}, oauth: {} },
    }),
    {},
  )
  const doc = (await generateOpenApi(api, { prefix: '' })) as any
  assert.deepEqual(Object.keys(doc.components.securitySchemes), ['apiKey', 'basic', 'oauth'])
  assert.deepEqual(doc.components.securitySchemes.apiKey, { type: 'apiKey', in: 'header', name: 'x-api-key' })
  assert.equal(doc.components.securitySchemes.basic.scheme, 'basic')
  assert.equal(doc.components.securitySchemes.oauth.scheme, 'bearer')
})
