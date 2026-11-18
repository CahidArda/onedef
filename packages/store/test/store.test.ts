import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import { Redis } from '@upstash/redis'
import {
  action,
  collection,
  createClient,
  defineApi,
  defineConfig,
  defineService,
  fail,
  local,
  query,
  singleton,
  type Backend,
} from 'onedef'
import { z } from 'zod'
import { implementStore, memoryStore, type Store } from '../src/index.js'
import { fsStore } from '../src/fs.js'
import { redisStore, type RedisClient } from '../src/redis.js'

// ---------------------------------------------------------------- the contract

const Song = z.object({ slug: z.string(), title: z.string(), region: z.string(), plays: z.number() })
const Note = z.object({ id: z.string(), text: z.string(), color: z.string() })
const Account = z.object({ name: z.string(), theme: z.string() })
const Settings = z.object({ volume: z.number() })

const config = defineConfig({ name: 'misrava' })

const songs = collection(config, {
  name: 'songs',
  description: 'Song lessons.',
  id: 'slug',
  fields: Song,
  summary: Song.pick({ slug: true, title: true, region: true }),
  list: { input: z.object({ region: z.string().optional() }), paginate: 'cursor' },
  create: { input: z.object({ title: z.string().min(1), region: z.string().default('eu') }) },
  delete: true,
  actions: {
    rename: action({ summary: 'Rename', input: z.object({ title: z.string() }), output: Song, needs: 'object' }),
    play: action({ summary: 'Count a play', output: Song, needs: 'object' }),
    // not the fields schema: an ordinary handler, nothing written back
    plays: action({ summary: 'Play count', output: z.object({ plays: z.number() }), needs: 'object' }),
    // collection-level, returns the object: written under the returned id
    import: action({ summary: 'Import one', input: Song, output: Song, on: 'collection' }),
  },
})

// no pagination, no create, no delete
const notes = collection(config, {
  name: 'notes',
  description: 'Notes.',
  id: 'id',
  fields: Note,
  list: { input: z.object({ color: z.string().optional() }) },
  actions: {
    write: action({ summary: 'Write a note', input: z.object({ text: z.string() }), output: Note, on: 'collection' }),
  },
})

const account = singleton(config, {
  name: 'account',
  description: 'You.',
  fields: Account,
  actions: {
    rename: action({ summary: 'Rename', input: z.object({ name: z.string() }), output: Account, needs: 'object' }),
  },
})

const settings = singleton(config, {
  name: 'settings',
  description: 'Settings.',
  fields: Settings,
  actions: { set: action({ summary: 'Set', input: Settings, output: Settings }) },
})

const stats = defineService(config, {
  name: 'stats',
  description: 'Numbers.',
  ops: { ping: query({ summary: 'Ping', output: z.object({ ok: z.boolean() }) }) },
})

const contract = defineApi(config, { songs, notes, account, settings, stats })

/**
 * Collection-level actions (`on: 'collection'`) are typed as member ops by
 * core's `ActionOp` (it checks `{ on: … }` as a required key), so the typed
 * client would demand an id. Call them through the backend instead.
 */
const collectionCall = (backend: Backend) => (service: string, op: string, input: Record<string, unknown>) =>
  backend.handle({ service, op, input })

const slugify = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

function makeBackend(store: Store) {
  return implementStore(contract, store, {
    songs: {
      create: ({ input }) => ({ slug: slugify(input.title), title: input.title, region: input.region, plays: 0 }),
      rename: ({ object, input }) => ({ ...object, title: input.title }),
      play: ({ object }) => ({ ...object, plays: object.plays + 1 }),
      plays: ({ object }) => ({ plays: object.plays }),
      import: ({ input }) => input,
    },
    notes: {
      write: ({ input }) => ({ id: slugify(input.text), text: input.text, color: 'yellow' }),
    },
    account: {
      initial: { name: 'guest', theme: 'light' },
      rename: ({ object, input }) => ({ ...object, name: input.name }),
    },
    settings: { set: ({ input }) => input },
    stats: { ping: () => ({ ok: true }) },
  })
}

// ---------------------------------------------------------------- a fake @upstash/redis

/**
 * The subset of @upstash/redis that redisStore uses, over Maps — including
 * its default `automaticDeserialization` (replies that parse as JSON come
 * back parsed, so a numeric id comes back as a number).
 */
function fakeRedis(): RedisClient {
  const hashes = new Map<string, Map<string, string>>()
  const sets = new Map<string, Set<string>>()
  const parse = (raw: string): unknown => {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  const hash = (key: string) => hashes.get(key) ?? hashes.set(key, new Map()).get(key)!
  const set = (key: string) => sets.get(key) ?? sets.set(key, new Set()).get(key)!
  const ops = {
    hset: (key: string, kv: Record<string, string>) => {
      let added = 0
      for (const [field, value] of Object.entries(kv)) {
        if (!hash(key).has(field)) added++
        hash(key).set(field, value)
      }
      return added
    },
    hdel: (key: string, ...fields: string[]) => fields.filter((field) => hash(key).delete(field)).length,
    zadd: (key: string, { member }: { score: number; member: string }) =>
      set(key).has(member) ? 0 : (set(key).add(member), 1),
    zrem: (key: string, ...members: string[]) => members.filter((member) => set(key).delete(member)).length,
  }
  return {
    async hget(key, field) {
      const raw = hashes.get(key)?.get(field)
      return raw === undefined ? null : parse(raw)
    },
    async hmget(key, ...fields) {
      if (!hashes.has(key)) return null
      return Object.fromEntries(
        fields.map((field) => [field, hash(key).has(field) ? parse(hash(key).get(field)!) : null]),
      )
    },
    async hsetnx(key, field, value) {
      if (hash(key).has(field)) return 0
      hash(key).set(field, value)
      return 1
    },
    async zadd(key, scoreMember) {
      return ops.zadd(key, scoreMember)
    },
    async zrange(key, min, max, { offset, count }) {
      assert.equal(max, '+')
      const sorted = [...(sets.get(key) ?? [])].sort()
      const after = min === '-' ? sorted : sorted.filter((member) => member > min.slice(1))
      return after.slice(offset, offset + count).map(parse)
    },
    multi() {
      const queued: (() => unknown)[] = []
      return {
        hset: (key, kv) => queued.push(() => ops.hset(key, kv)),
        hdel: (key, ...fields) => queued.push(() => ops.hdel(key, ...fields)),
        zadd: (key, scoreMember) => queued.push(() => ops.zadd(key, scoreMember)),
        zrem: (key, ...members) => queued.push(() => ops.zrem(key, ...members)),
        exec: async () => queued.map((run) => run()),
      }
    },
  }
}

// ---------------------------------------------------------------- one suite, every store

const dirs: string[] = []
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})
const tempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'onedef-store-'))
  dirs.push(dir)
  return dir
}

const stores: [string, () => Promise<Store>][] = [
  ['memoryStore', async () => memoryStore()],
  ['fsStore', async () => fsStore(await tempDir())],
  ['redisStore', async () => redisStore(fakeRedis(), { prefix: 'test:' })],
]

for (const [label, make] of stores) {
  describe(label, () => {
    const setup = async () => {
      const store = await make()
      const backend = makeBackend(store)
      return { store, backend, client: createClient(contract, local(backend)), call: collectionCall(backend) }
    }

    test('store contract: put / get / list / delete, ifAbsent', async () => {
      const store = await make()
      assert.equal(await store.get('things', 'a'), undefined)
      assert.equal(await store.put('things', 'b', { n: 2 }), true)
      assert.equal(await store.put('things', 'a', { n: 1 }), true)
      assert.equal(await store.put('things', 'a', { n: 9 }, { ifAbsent: true }), false)
      assert.deepEqual(await store.get('things', 'a'), { n: 1 })
      assert.equal(await store.put('things', '10', { n: 10 }), true)
      assert.deepEqual(await store.list('things'), { items: [{ n: 10 }, { n: 1 }, { n: 2 }] })
      assert.deepEqual(await store.list('things', { limit: 2 }), { items: [{ n: 10 }, { n: 1 }], nextCursor: 'a' })
      assert.deepEqual(await store.list('things', { cursor: 'a', limit: 2 }), { items: [{ n: 2 }] })
      assert.deepEqual(await store.list('nothing'), { items: [] })
      assert.equal(await store.delete('things', 'a'), true)
      assert.equal(await store.delete('things', 'a'), false)
      assert.deepEqual(await store.list('things'), { items: [{ n: 10 }, { n: 2 }] })
      // namespaces are separate
      await store.put('others', 'a', { other: true })
      assert.equal(await store.get('things', 'a'), undefined)
    })

    test('CRUD through the client', async () => {
      const { client } = await setup()
      const created = await client.songs.create({ title: 'La Vie en Rose' })
      assert.deepEqual(created, { slug: 'la-vie-en-rose', title: 'La Vie en Rose', region: 'eu', plays: 0 })
      assert.deepEqual(await client.songs.get({ slug: 'la-vie-en-rose' }), created)
      assert.deepEqual(await client.songs.list({}), {
        items: [{ slug: 'la-vie-en-rose', title: 'La Vie en Rose', region: 'eu' }],
      })
      await assert.rejects(client.songs.create({ title: 'La vie en rose' }), { code: 'CONFLICT' })
      await assert.rejects(client.songs.get({ slug: 'nope' }), { code: 'NOT_FOUND' })
      await client.songs.delete({ slug: 'la-vie-en-rose' })
      await assert.rejects(client.songs.get({ slug: 'la-vie-en-rose' }), { code: 'NOT_FOUND' })
      await assert.rejects(client.songs.delete({ slug: 'la-vie-en-rose' }), { code: 'NOT_FOUND' })
      assert.deepEqual(await client.songs.list({}), { items: [] })
    })

    test('pagination and equality filters', async () => {
      const { client, call } = await setup()
      for (const [title, region] of [
        ['a', 'eu'],
        ['b', 'us'],
        ['c', 'eu'],
        ['d', 'us'],
        ['e', 'eu'],
        ['f', 'eu'],
      ] as const) {
        await client.songs.create({ title, region })
      }
      const first = await client.songs.list({ limit: 4 })
      assert.deepEqual(
        first.items.map((song) => song.slug),
        ['a', 'b', 'c', 'd'],
      )
      assert.equal(first.nextCursor, 'd')
      const second = await client.songs.list({ limit: 4, cursor: first.nextCursor! })
      assert.deepEqual(
        second.items.map((song) => song.slug),
        ['e', 'f'],
      )
      assert.equal(second.nextCursor, undefined)

      // filtered pages stay full and continue where they stopped
      const eu1 = await client.songs.list({ region: 'eu', limit: 2 })
      assert.deepEqual(
        eu1.items.map((song) => song.slug),
        ['a', 'c'],
      )
      const eu2 = await client.songs.list({ region: 'eu', limit: 2, cursor: eu1.nextCursor! })
      assert.deepEqual(
        eu2.items.map((song) => song.slug),
        ['e', 'f'],
      )
      const us = await client.songs.list({ region: 'us' })
      assert.deepEqual(
        us.items.map((song) => song.slug),
        ['b', 'd'],
      )
      assert.equal(us.nextCursor, undefined)

      // unpaginated: everything, filtered
      await call('notes', 'write', { text: 'one' })
      await call('notes', 'write', { text: 'two' })
      assert.equal((await client.notes.list({})).length, 2)
      assert.deepEqual(await client.notes.list({ color: 'blue' }), [])
      assert.equal((await client.notes.list({ color: 'yellow' })).length, 2)
    })

    test('actions returning the object are written back; others are not', async () => {
      const { client, call } = await setup()
      await client.songs.create({ title: 'Song' })
      const renamed = await client.songs.rename({ slug: 'song', title: 'Renamed' })
      assert.equal(renamed.title, 'Renamed')
      await client.songs.play({ slug: 'song' })
      await client.songs.play({ slug: 'song' })
      assert.deepEqual(await client.songs.get({ slug: 'song' }), {
        slug: 'song',
        title: 'Renamed',
        region: 'eu',
        plays: 2,
      })
      assert.deepEqual(await client.songs.plays({ slug: 'song' }), { plays: 2 })
      await assert.rejects(client.songs.rename({ slug: 'missing', title: 'x' }), { code: 'NOT_FOUND' })

      // collection-level action: stored under the returned object's id (upsert)
      await call('songs', 'import', { slug: 'imported', title: 'Imported', region: 'us', plays: 7 })
      assert.equal((await client.songs.get({ slug: 'imported' })).plays, 7)
      // member action without needs: 'object'
      await call('notes', 'write', { text: 'hello' })
      assert.deepEqual(await client.notes.get({ id: 'hello' }), { id: 'hello', text: 'hello', color: 'yellow' })
    })

    test('singletons: initial, NOT_FOUND, actions write back', async () => {
      const { client } = await setup()
      assert.deepEqual(await client.account.get(), { name: 'guest', theme: 'light' })
      assert.deepEqual(await client.account.rename({ name: 'ada' }), { name: 'ada', theme: 'light' })
      assert.deepEqual(await client.account.get(), { name: 'ada', theme: 'light' })

      await assert.rejects(client.settings.get(), { code: 'NOT_FOUND' })
      await client.settings.set({ volume: 3 })
      assert.deepEqual(await client.settings.get(), { volume: 3 })
    })

    test('a plain service is implemented as usual', async () => {
      const { client } = await setup()
      assert.deepEqual(await client.stats.ping(), { ok: true })
    })

    test('a generated op can be overridden; the rest stay generated', async () => {
      const store = await make()
      const backend = implementStore(contract, store, {
        songs: {
          create: ({ input }) => ({ slug: slugify(input.title), title: input.title, region: input.region, plays: 0 }),
          get: async ({ id }) => ({ slug: id, title: 'from the override', region: 'eu', plays: 42 }),
          rename: ({ object, input }) => ({ ...object, title: input.title }),
          play: ({ object }) => ({ ...object, plays: object.plays + 1 }),
          plays: ({ object }) => ({ plays: object.plays }),
          import: ({ input }) => input,
        },
        notes: { write: ({ input }) => ({ id: input.text, text: input.text, color: 'red' }) },
        account: { rename: ({ object, input }) => ({ ...object, name: input.name }) },
        settings: { set: ({ input }) => input },
        stats: { ping: () => ({ ok: false }) },
      })
      const client = createClient(contract, local(backend))
      assert.equal((await client.songs.get({ slug: 'anything' })).plays, 42)
      // needs: 'object' loads through the overridden get, and the result is still written back
      await client.songs.play({ slug: 'x' })
      assert.equal((await store.get('songs', 'x'))?.plays, 43)
      assert.equal((await client.songs.list({})).items.length, 1)
      // no `initial` here: NOT_FOUND
      await assert.rejects(client.account.get(), { code: 'NOT_FOUND' })
    })

    test('objects are validated before they are written; ids cannot change', async () => {
      const store = await make()
      const backend = implementStore(contract, store, {
        songs: {
          create: ({ input }) => ({ slug: input.title, title: input.title, region: 'eu', plays: 0 }),
          rename: ({ object }) => ({ ...object, slug: 'other' }),
          play: ({ object }) => ({ ...object, plays: 'many' }) as never,
          plays: () => ({ plays: 0 }),
          import: ({ input }) => input,
        },
        notes: { write: ({ input }) => ({ id: input.text, text: input.text, color: 'red' }) },
        account: { rename: ({ object }) => object },
        settings: { set: ({ input }) => input },
        stats: { ping: () => ({ ok: true }) },
      })
      const client = createClient(contract, local(backend))
      await client.songs.create({ title: 'x' })
      await assert.rejects(client.songs.rename({ slug: 'x', title: 'y' }), {
        code: 'INTERNAL',
        message: /ids are fixed/,
      })
      await assert.rejects(client.songs.play({ slug: 'x' }), { code: 'INTERNAL', message: /does not match the fields/ })
      assert.deepEqual(await store.get('songs', 'x'), { slug: 'x', title: 'x', region: 'eu', plays: 0 })
    })

    test('partition keeps tenants apart', async () => {
      const store = await make()
      const backend = implementStore(contract, store, {
        context: ({ request }) => ({ user: request?.headers.get('x-user') ?? 'anon' }),
        partition: ({ ctx }) => ctx.user,
        songs: {
          create: ({ input }) => ({ slug: slugify(input.title), title: input.title, region: input.region, plays: 0 }),
          rename: ({ object, input }) => ({ ...object, title: input.title }),
          play: ({ object }) => ({ ...object, plays: object.plays + 1 }),
          plays: ({ object }) => ({ plays: object.plays }),
          import: ({ input }) => input,
        },
        notes: { write: ({ input }) => ({ id: input.text, text: input.text, color: 'red' }) },
        account: {
          get: ({ ctx }) => ({ name: ctx.user, theme: 'dark' }),
          rename: ({ object, input }) => ({ ...object, name: input.name }),
        },
        settings: { set: ({ input }) => input },
        stats: { ping: () => ({ ok: true }) },
      })
      const as = (user: string) =>
        createClient(
          contract,
          local(backend, { request: () => new Request('http://x', { headers: { 'x-user': user } }) }),
        )
      await as('ada').songs.create({ title: 'mine' })
      assert.equal((await as('ada').songs.list({})).items.length, 1)
      assert.equal((await as('bob').songs.list({})).items.length, 0)
      await as('bob').songs.create({ title: 'mine' }) // same id, other tenant: no conflict
      assert.deepEqual(await as('bob').account.get(), { name: 'bob', theme: 'dark' })
      assert.ok(await store.get('songs/ada', 'mine'))
    })

    test('unsafe ids are rejected by the client-facing ops', async () => {
      const { client } = await setup()
      // every store rejects nothing here except fs, but none may crash or escape
      const result = await client.songs.get({ slug: '../../etc/passwd' }).catch((error) => error)
      assert.ok(['NOT_FOUND', 'INVALID_INPUT'].includes(result.code), result.message)
    })
  })
}

// ---------------------------------------------------------------- fs specifics

describe('fsStore files', () => {
  test('one pretty JSON file per object, no temp files left', async () => {
    const dir = await tempDir()
    const client = createClient(contract, local(makeBackend(fsStore(dir))))
    await client.songs.create({ title: 'Hello' })
    await client.songs.rename({ slug: 'hello', title: 'Hi' })
    assert.deepEqual(await readdir(join(dir, 'songs')), ['hello.json'])
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'songs', 'hello.json'), 'utf8')), {
      slug: 'hello',
      title: 'Hi',
      region: 'eu',
      plays: 0,
    })
    await client.account.rename({ name: 'ada' })
    assert.deepEqual(await readdir(join(dir, 'account')), ['_.json'])
  })

  test('path traversal is rejected', async () => {
    const dir = await tempDir()
    const store = fsStore(join(dir, 'data'))
    for (const id of ['../escape', '..', '.', '.hidden', 'a/b', 'a\\b', '', 'nul\0', 'x'.repeat(201)]) {
      await assert.rejects(store.get('songs', id), { code: 'INVALID_INPUT' }, id)
      await assert.rejects(store.put('songs', id, {}), { code: 'INVALID_INPUT' }, id)
      await assert.rejects(store.delete('songs', id), { code: 'INVALID_INPUT' }, id)
    }
    for (const ns of ['..', '../x', 'a/../..', '/abs', 'a//b']) {
      await assert.rejects(store.put(ns, 'id', {}), { code: 'INVALID_INPUT' }, ns)
      await assert.rejects(store.list(ns), { code: 'INVALID_INPUT' }, ns)
    }
    assert.deepEqual(await readdir(dir), [])

    const backend = makeBackend(store)
    const client = createClient(contract, local(backend))
    await assert.rejects(client.songs.get({ slug: '../../etc/passwd' }), { code: 'INVALID_INPUT' })
    await assert.rejects(client.songs.delete({ slug: '..' }), { code: 'INVALID_INPUT' })
    await assert.rejects(
      collectionCall(backend)('songs', 'import', { slug: '../x', title: 't', region: 'eu', plays: 0 }),
      {
        code: 'INVALID_INPUT',
      },
    )
  })
})

// ---------------------------------------------------------------- startup checks

test('a missing handler is a runtime error too', () => {
  assert.throws(
    () =>
      implementStore(contract, memoryStore(), {
        songs: { rename: () => null, play: () => null, plays: () => null, import: () => null },
        notes: { write: () => null },
        account: { rename: () => null },
        settings: { set: () => null },
        stats: { ping: () => ({ ok: true }) },
      } as never),
    /missing a handler for songs\.create/,
  )
  assert.throws(() => implementStore(contract, memoryStore(), {} as never), /missing a handler for songs\.create/)
})

test('a list filter that is not an object field needs a hand-written list', () => {
  const searchable = collection(config, {
    name: 'docs',
    description: 'Docs.',
    id: 'id',
    fields: Note,
    list: { input: z.object({ q: z.string().optional() }) },
  })
  const api = defineApi(config, { searchable })
  // @ts-expect-error `list` is required: `q` is not a field, so it cannot be generated
  assert.throws(() => implementStore(api, memoryStore(), {}), /"q", which is not a field of docs/)
  const backend = implementStore(api, memoryStore(), { searchable: { list: () => [] } })
  assert.ok(backend)
})

// ---------------------------------------------------------------- compile-time checks (never run)

export function typeChecks() {
  const store = memoryStore()

  // a contract with only generated ops needs no handlers at all
  implementStore(
    defineApi(config, { notes: collection(config, { name: 'n', description: 'n', id: 'id', fields: Note }) }),
    store,
    {},
  )

  // ctx flows from context() into the handlers and partition()
  implementStore(contract, store, {
    context: () => ({ userId: 'u' }),
    partition: ({ ctx }) => ctx.userId,
    songs: {
      create: ({ input, ctx }) => ({ slug: ctx.userId, title: input.title, region: input.region, plays: 0 }),
      rename: ({ object, input }) => ({ ...object, title: input.title }),
      play: ({ object }) => object,
      plays: ({ object }) => ({ plays: object.plays }),
      import: ({ input }) => input,
    },
    notes: { write: ({ input }) => ({ id: input.text, text: input.text, color: 'red' }) },
    account: { initial: { name: 'guest', theme: 'x' }, rename: ({ object }) => object },
    settings: { set: ({ input }) => input },
    stats: { ping: () => ({ ok: true }) },
  })

  implementStore(contract, store, {
    // @ts-expect-error songs.create is required for a collection that declares create
    songs: {
      rename: ({ object, input }) => ({ ...object, title: input.title }),
      play: ({ object }) => object,
      plays: ({ object }) => ({ plays: object.plays }),
      import: ({ input }) => input,
    },
    notes: { write: ({ input }) => ({ id: input.text, text: input.text, color: 'red' }) },
    account: { rename: ({ object }) => object },
    settings: { set: ({ input }) => input },
    stats: { ping: () => ({ ok: true }) },
  })

  implementStore(contract, store, {
    songs: {
      // @ts-expect-error create must return the whole object
      create: ({ input }) => ({ slug: input.title }),
      // @ts-expect-error an action whose output is the fields returns the object
      rename: ({ object }) => ({ ...object, plays: 'many' }),
      play: ({ object }) => object,
      plays: ({ object }) => ({ plays: object.plays }),
      import: ({ input }) => input,
    },
    notes: { write: ({ input }) => ({ id: input.text, text: input.text, color: 'red' }) },
    account: { rename: ({ object }) => object },
    settings: { set: ({ input }) => input },
    // @ts-expect-error a plain service needs every handler
    stats: {},
  })

  // the real client fits redisStore
  redisStore(new Redis({ url: 'https://example.upstash.io', token: 'token' }))
}

describe('processes', () => {
  test('an action with process: true keeps its runs in the same store and writes the result back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'onedef-store-runs-'))
    after(() => rm(dir, { recursive: true, force: true }))
    const Doc = z.object({ id: z.string(), text: z.string(), summary: z.string().optional() })
    const docs = collection(defineConfig({ name: 'p' }), {
      name: 'docs',
      description: 'Docs.',
      id: 'id',
      fields: Doc,
      create: { input: Doc },
      actions: {
        summarize: action({ summary: 'Summarize it', needs: 'object', output: Doc, process: true }),
      },
    })
    const api = defineApi(defineConfig({ name: 'p' }), { docs })
    const backend = () =>
      implementStore(api, fsStore(dir), {
        docs: {
          create: ({ input }) => input,
          summarize: async ({ object, elicitAgentInput }) => {
            const { summary } = await elicitAgentInput('summary', { schema: z.object({ summary: z.string() }), data: object.text })
            return { ...object, summary }
          },
        },
      })
    await createClient(api, local(backend())).docs.create({ id: 'a', text: 'long text' })
    const start = await createClient(api, local(backend())).docs.summarizeStart({ id: 'a' })
    assert.equal(start.waitingFor?.data, 'long text')
    assert.ok((await readdir(join(dir, '_runs'))).includes(`${start.runId}.json`), 'the run lives in the store')
    const done = await createClient(api, local(backend())).docs.summarizeNext({
      runId: start.runId,
      payload: { summary: 'short' },
    })
    assert.equal(done.status, 'done')
    assert.equal((await createClient(api, local(backend())).docs.get({ id: 'a' })).summary, 'short', 'written back')
  })
})
