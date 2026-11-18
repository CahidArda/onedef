import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import {
  createClient,
  defineApi,
  defineConfig,
  defineService,
  fail,
  forMode,
  http,
  implement,
  local,
  mutation,
  query,
  routeOf,
  toJsonSchema,
  toolName,
  type InputOf,
  type OutputOf,
} from '../src/index.js'

const Song = z.object({ slug: z.string(), title: z.string(), secret: z.string().optional() })

const config = defineConfig({
  name: 'misrava',
  scopes: { team: { header: 'X-Team', description: 'team', required: true } },
  modes: ['apikey', 'oauth'],
})

const songs = defineService(config, {
  name: 'songs',
  description: 'Song lessons.',
  id: 'slug',
  restrict: { secret: ['apikey'] },
  ops: {
    list: query({ summary: 'List', output: z.array(Song) }),
    get: query({ on: 'member', summary: 'Get', output: Song }),
    create: mutation({
      summary: 'Create',
      input: z.object({ title: z.string().min(1) }),
      output: Song,
      scope: ['team'],
    }),
    setOffset: mutation({
      on: 'member',
      summary: 'Offset',
      input: z.object({ offsetMs: z.number() }),
      modes: ['apikey'],
    }),
    remote: query({
      summary: 'Remote',
      output: z.object({ ok: z.boolean(), url: z.string().optional(), auth: z.string().nullable().optional() }),
      http: { method: 'GET', path: '/ok' },
    }),
  },
})

// @ts-expect-error unknown scope name
defineService(config, { name: 'x', description: '', ops: { a: query({ summary: '', scope: ['tem'] }) } })
defineService(config, {
  name: 'x',
  description: '',
  ops: { a: query({ summary: '', output: Song }) },
  // @ts-expect-error `restrict` must name a field some op returns
  restrict: { nope: ['apikey'] },
})

const contract = defineApi(config, { songs })

const db = new Map([['a', { slug: 'a', title: 'A', secret: 's' }]])

const backend = implement(contract, {
  context: async ({ request }) => ({ user: request?.headers.get('x-user') ?? 'anon' }),
  songs: {
    list: async ({ ctx }) => {
      const user: string = ctx.user
      void user
      return [...db.values()]
    },
    get: async ({ id }) => db.get(id) ?? fail('NOT_FOUND', `no ${id}`),
    create: async ({ input, scope, ctx }) => ({
      slug: input.title.toLowerCase(),
      title: `${input.title}@${scope.team}:${ctx.user}`,
    }),
    setOffset: async ({ id, input, client }) => {
      const song = await client.songs.get({ slug: id })
      return { offset: input.offsetMs, title: song.title }
    },
    // `remote` has an http descriptor, so its handler is optional
  },
})

export const _missingHandler = () =>
  implement(contract, {
    // @ts-expect-error missing handler for songs.get
    songs: { list: async () => [], create: async () => ({ slug: '', title: '' }), setOffset: async () => ({}) },
  })

type CreateIn = InputOf<typeof contract, 'songs', 'create'>
const createIn: CreateIn = { title: 'x' }
void createIn
type GetOut = OutputOf<typeof contract, 'songs', 'get'>
const got: GetOut = { slug: 'a', title: 'A' }
void got

test('local transport: typed calls, validation, errors, scope, context, client-in-handler', async () => {
  const client = createClient(contract, local(backend))
  const list = await client.songs.list()
  assert.equal(list[0]!.title, 'A')
  // @ts-expect-error member ops need the id
  await assert.rejects(client.songs.get({}), /needs "slug"/)
  await assert.rejects(client.songs.get({ slug: 'zz' }), (e: any) => e.code === 'NOT_FOUND' && e.status === 404)
  await assert.rejects(
    client.songs.create({ title: '' }, { scope: { team: 't' } }),
    (e: any) => e.code === 'INVALID_INPUT',
  )
  await assert.rejects(client.songs.create({ title: 'X' }), /"team" scope/)
  const created = await client.songs.create({ title: 'X' }, { scope: { team: 't1' } })
  assert.equal(created.title, 'X@t1:anon')
  assert.deepEqual(await client.songs.setOffset({ slug: 'a', offsetMs: 5 }), { offset: 5, title: 'A' })

  const req = new Request('http://x', { headers: { 'x-user': 'ada' } })
  const asAda = createClient(contract, local(backend, { request: () => req }))
  assert.equal((await asAda.songs.create({ title: 'Y' }, { scope: { team: 't' } })).title, 'Y@t:ada')
})

test('context() runs once per inbound call, not per nested client call', async () => {
  let runs = 0
  const counted = implement(contract, {
    context: () => ({ user: String(++runs) }),
    songs: {
      list: async ({ client }) => [await client.songs.get({ slug: 'a' }), await client.songs.get({ slug: 'a' })],
      get: async ({ id }) => db.get(id)!,
      create: async () => ({ slug: '', title: '' }),
      setOffset: async () => ({}),
    },
  })
  await createClient(contract, local(counted)).songs.list()
  assert.equal(runs, 1)
})

test('forMode hides fields and ops in schema and values', async () => {
  const oauth = forMode(backend, 'oauth')
  const client = createClient(oauth.api, local(oauth))
  const song = await client.songs.get({ slug: 'a' })
  assert.equal('secret' in song, false)
  assert.equal('setOffset' in oauth.api.services.songs.ops, false)
  const js = toJsonSchema(oauth.api.services.songs.ops.get.output, 'output')
  assert.equal(Object.keys(js.properties ?? {}).includes('secret'), false)
  const listJs = toJsonSchema(oauth.api.services.songs.ops.list.output, 'output')
  assert.equal(Object.keys(listJs.items?.properties ?? {}).includes('secret'), false)
})

test('http transport executes descriptors; backend proxies unimplemented descriptor ops', async () => {
  const fetch = (async (url: URL, init: RequestInit) =>
    new Response(
      JSON.stringify({ ok: true, url: String(url), auth: new Headers(init.headers).get('authorization') }),
    )) as any
  const direct = createClient(contract, http({ baseUrl: 'https://api.test/v1', fetch, auth: { apiKey: 'k' } }))
  assert.equal((await direct.songs.remote()).ok, true)

  const proxied = implement(contract, backendHandlers(), { upstream: { baseUrl: 'https://api.test', fetch } })
  const res: any = await createClient(
    contract,
    local(proxied, { request: () => new Request('http://x', { headers: { authorization: 'Bearer caller' } }) }),
  ).songs.remote()
  assert.equal(res.url, 'https://api.test/ok')
  assert.equal(res.auth, 'Bearer caller')
})

function backendHandlers() {
  return {
    songs: {
      list: async () => [],
      get: async () => ({ slug: '', title: '' }),
      create: async () => ({ slug: '', title: '' }),
      setOffset: async () => ({}),
    },
  }
}

test('names are derived once', () => {
  assert.equal(toolName(contract, 'songs', 'setOffset'), 'songs_set_offset')
  const svc = contract.services.songs
  assert.deepEqual(routeOf(svc, 'list', svc.ops.list), { method: 'GET', path: '/songs', operationId: 'songs.list' })
  assert.equal(routeOf(svc, 'get', svc.ops.get).path, '/songs/{slug}')
  assert.equal(routeOf(svc, 'setOffset', svc.ops.setOffset, '/api').path, '/api/songs/{slug}/set-offset')
  assert.equal(routeOf(svc, 'create', svc.ops.create).method, 'POST')
})
