import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import {
  action,
  collection,
  createClient,
  defineApi,
  defineConfig,
  fail,
  forMode,
  http,
  implement,
  local,
  query,
  routeOf,
  singleton,
  toJsonSchema,
  type OutputOf,
} from '../src/index.js'

const Song = z.object({ slug: z.string(), title: z.string(), plays: z.number(), token: z.string().optional() })
const SongSummary = Song.pick({ slug: true, title: true })
const Account = z.object({ name: z.string() })

const config = defineConfig({ name: 'acme', modes: ['apikey', 'oauth'] })

const songs = collection(config, {
  name: 'songs',
  description: 'Song lessons.',
  id: 'slug',
  fields: Song,
  summary: SongSummary,
  create: { input: z.object({ title: z.string().min(1) }) },
  delete: true,
  restrict: { token: ['apikey'] },
  actions: {
    rename: action({
      summary: 'Rename a song',
      input: z.object({ title: z.string().min(1) }),
      output: Song,
      needs: 'object',
    }),
    play: action({ summary: 'Count a play', output: z.object({ plays: z.number() }) }),
    reindex: action({ summary: 'Rebuild the index', on: 'collection' }),
  },
  queries: { search: query({ summary: 'Search', input: z.object({ q: z.string() }), output: z.array(SongSummary) }) },
})

const account = singleton(config, {
  name: 'account',
  description: 'You.',
  fields: Account,
  actions: {
    rename: action({
      summary: 'Rename yourself',
      input: z.object({ name: z.string() }),
      output: Account,
      on: 'collection',
      needs: 'object',
    }),
  },
})

const contract = defineApi(config, { songs, account })

const db = new Map<string, z.infer<typeof Song>>([['a', { slug: 'a', title: 'A', plays: 0, token: 'secret' }]])
let me = { name: 'ada' }
const seen: string[] = []

const backend = implement(contract, {
  songs: {
    list: () => [...db.values()],
    get: ({ id }) => db.get(id) ?? fail('NOT_FOUND', `no ${id}`),
    create: ({ input }) => {
      const song = { slug: input.title.toLowerCase(), title: input.title, plays: 0 }
      db.set(song.slug, song)
      return song
    },
    delete: ({ id }) => void db.delete(id),
    rename: ({ id, input, object }) => {
      // `object` is typed from `fields` and was loaded through `get`
      seen.push(`${object.title}->${input.title}:${object.token ?? 'hidden'}`)
      const song = { ...object, title: input.title }
      db.set(id, song)
      return song
    },
    play: ({ id }) => {
      const song = db.get(id)!
      song.plays++
      return { plays: song.plays }
    },
    reindex: () => undefined,
    search: ({ input }) => [...db.values()].filter((s) => s.title.includes(input.q)),
  },
  account: {
    get: () => me,
    rename: ({ input, object }) => {
      seen.push(`${object.name}->${input.name}`)
      return (me = { name: input.name })
    },
  },
})

export const _typeChecks = () => {
  // @ts-expect-error rename needs `title`
  void createClient(contract, local(backend)).songs.rename({ slug: 'a' })
  // @ts-expect-error a singleton has no list
  void createClient(contract, local(backend)).account.list
  const got: OutputOf<typeof contract, 'songs', 'get'> = { slug: 'a', title: 'A', plays: 1 }
  const listed: OutputOf<typeof contract, 'songs', 'list'> = [{ slug: 'a', title: 'A' }]
  ;(void got, listed)
}

test('a collection compiles to conventional ops and routes', () => {
  const svc = contract.services.songs
  assert.deepEqual(Object.keys(svc.ops), ['list', 'get', 'create', 'delete', 'rename', 'play', 'reindex', 'search'])
  const route = (op: string) => {
    const r = routeOf(svc, op, svc.ops[op as keyof typeof svc.ops])
    return `${r.method} ${r.path}`
  }
  assert.deepEqual(['list', 'get', 'create', 'delete', 'rename', 'reindex', 'search'].map(route), [
    'GET /songs',
    'GET /songs/{slug}',
    'POST /songs',
    'DELETE /songs/{slug}',
    'POST /songs/{slug}/rename',
    'POST /songs/reindex',
    'GET /songs/search',
  ])
  assert.equal(svc.ops.delete.destructive, true)
  assert.equal(svc.resource?.kind, 'collection')
  assert.deepEqual(toJsonSchema(svc.ops.list.output, 'output').items?.required, ['slug', 'title'])
  const acct = contract.services.account
  assert.deepEqual(Object.keys(acct.ops), ['get', 'rename'])
  assert.equal(
    `${routeOf(acct, 'get', acct.ops.get).method} ${routeOf(acct, 'get', acct.ops.get).path}`,
    'GET /account',
  )
  assert.equal(routeOf(acct, 'rename', acct.ops.rename).path, '/account/rename')
})

test('needs: object loads the object through get, on collections and singletons', async () => {
  const client = createClient(contract, local(backend))
  const renamed = await client.songs.rename({ slug: 'a', title: 'B' })
  assert.equal(renamed.title, 'B')
  await assert.rejects(client.songs.rename({ slug: 'zz', title: 'x' }), (e: any) => e.code === 'NOT_FOUND')
  assert.deepEqual(await client.account.rename({ name: 'grace' }), { name: 'grace' })
  assert.deepEqual(seen, ['A->B:secret', 'ada->grace'])
  assert.deepEqual(await client.songs.list(), [{ slug: 'a', title: 'B' }]) // summary strips the rest
  await client.songs.create({ title: 'C' })
  await client.songs.delete({ slug: 'c' })
  assert.equal(db.has('c'), false)
})

test('forMode hides restricted fields from callers, not from the handler reading them', async () => {
  seen.length = 0
  const oauth = forMode(backend, 'oauth')
  const client = createClient(oauth.api, local(oauth))
  const song = await client.songs.rename({ slug: 'a', title: 'D' })
  assert.equal('token' in song, false) // the caller never sees it
  assert.deepEqual(seen, ['B->D:secret']) // the handler's object still has it
})

test('http() validates outputs too: undeclared upstream fields are stripped', async () => {
  const remote = defineApi(config, {
    songs: collection(config, {
      name: 'songs',
      description: '',
      id: 'slug',
      fields: SongSummary,
      get: { http: { method: 'GET', path: '/songs/{id}' } },
      list: { http: { method: 'GET', path: '/songs' } },
    }),
  })
  const fetch = (async () => Response.json({ slug: 'a', title: 'A', internal: 'leak' })) as any
  const got = await createClient(remote, http({ baseUrl: 'https://x.test', fetch })).songs.get({ slug: 'a' })
  assert.deepEqual(got, { slug: 'a', title: 'A' })
})

test('paginate: cursor — typed pages, cursor/limit next to filters, validated, described', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ slug: `s${i}`, title: i % 2 ? 'odd' : 'even', plays: i }))
  const paged = defineApi(config, {
    songs: collection(config, {
      name: 'songs',
      description: '',
      id: 'slug',
      fields: Song,
      list: { input: z.object({ title: z.string().optional() }), paginate: 'cursor' },
    }),
  })
  const server = implement(paged, {
    songs: {
      list: ({ input }) => {
        const matches = items.filter((s) => !input.title || s.title === input.title)
        const start = Number(input.cursor ?? 0)
        const end = start + (input.limit ?? 2)
        return { items: matches.slice(start, end), ...(end < matches.length ? { nextCursor: String(end) } : {}) }
      },
      get: ({ id }) => items.find((s) => s.slug === id) ?? fail('NOT_FOUND'),
    },
  })
  const client = createClient(paged, local(server))
  const first = await client.songs.list({ limit: 2 })
  assert.deepEqual(
    first.items.map((s) => s.slug),
    ['s0', 's1'],
  )
  assert.equal(first.nextCursor, '2')
  const last = await client.songs.list({ cursor: '4' })
  assert.equal(last.nextCursor, undefined)
  const filtered = await client.songs.list({ title: 'odd', limit: 10 })
  assert.deepEqual(
    filtered.items.map((s) => s.slug),
    ['s1', 's3'],
  )
  await assert.rejects(client.songs.list({ limit: 1000 }), (e: any) => e.code === 'INVALID_INPUT')
  // @ts-expect-error limit is a number
  void (() => client.songs.list({ limit: 'x' }))

  const op = paged.services.songs.ops.list
  assert.equal(op.paginate, 'cursor')
  assert.deepEqual(Object.keys(toJsonSchema(op.input).properties ?? {}), ['title', 'cursor', 'limit'])
  assert.deepEqual(toJsonSchema(op.output, 'output').required, ['items'])
})

test('a collection-level action is typed and called without an id', async () => {
  const client = createClient(contract, local(backend))
  // no id needed: the input is optional, unlike a member action's
  const noInput: Parameters<typeof client.songs.reindex>[0] = undefined
  // @ts-expect-error a member action needs its slug
  const needsId: Parameters<typeof client.songs.play>[0] = undefined
  ;(void noInput, needsId)
  assert.equal(await client.songs.reindex(), undefined)
})
