import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core'
import { z } from 'zod'
import {
  action,
  collection,
  createClient,
  defineApi,
  defineConfig,
  defineService,
  implement,
  local,
  query,
  singleton,
} from 'onedef'
import { createQueryUtils } from '../src/index.js'

const Song = z.object({ slug: z.string(), title: z.string() })
const Account = z.object({ name: z.string() })
const config = defineConfig({ name: 'acme' })

const songs = collection(config, {
  name: 'songs',
  description: 'Songs.',
  id: 'slug',
  fields: Song,
  summary: Song.pick({ slug: true }),
  list: { input: z.object({ q: z.string().optional() }) },
  create: { input: z.object({ title: z.string() }) },
  delete: true,
  actions: {
    rename: action({ summary: 'Rename', input: z.object({ title: z.string() }), output: Song }),
    play: action({ summary: 'Play', output: z.object({ plays: z.number() }), affects: ['stats'] }),
  },
})
const account = singleton(config, {
  name: 'account',
  description: 'You.',
  fields: Account,
  actions: { rename: action({ summary: 'Rename', input: z.object({ name: z.string() }), output: Account }) },
})
const stats = defineService(config, {
  name: 'stats',
  description: 'Stats.',
  ops: { total: query({ summary: 'Total plays', output: z.number() }) },
})
const contract = defineApi(config, { songs, account, stats })

const db = new Map<string, z.infer<typeof Song>>()
let plays = 0
let me = { name: 'ada' }
let seenSignal: AbortSignal | undefined
const reset = () => {
  db.clear()
  db.set('a', { slug: 'a', title: 'A' })
  db.set('b', { slug: 'b', title: 'B' })
  plays = 0
  me = { name: 'ada' }
}

const backend = implement(contract, {
  songs: {
    list: () => [...db.values()].map(({ slug }) => ({ slug })),
    get: ({ id }) => db.get(id)!,
    create: ({ input }) => {
      const song = { slug: input.title.toLowerCase(), title: input.title }
      db.set(song.slug, song)
      return song
    },
    delete: ({ id }) => void db.delete(id),
    rename: ({ id, input }) => {
      const song = { slug: id, title: input.title }
      db.set(id, song)
      return song
    },
    play: () => ({ plays: ++plays }),
  },
  account: { get: () => me, rename: ({ input }) => (me = { name: input.name }) },
  stats: { total: () => plays },
})

// A transport that records the signal TanStack passes, then answers in process.
const answer = local(backend)
const client = createClient(contract, (call, api) => {
  if (call.op === 'get') seenSignal = call.signal
  return answer(call, api)
})
const q = createQueryUtils(contract, client)

const mutate = <TVars>(qc: QueryClient, options: { mutationFn: (v: TVars, c: any) => Promise<unknown> }, vars: TVars) =>
  new MutationObserver(qc, options as never).mutate(vars as never)
const invalidated = (qc: QueryClient, key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated

export const _typeChecks = async (qc: QueryClient) => {
  // @ts-expect-error queryOptions exists only on query ops
  void q.songs.rename.queryOptions
  // @ts-expect-error mutationOptions exists only on mutation ops
  void q.songs.get.mutationOptions
  // @ts-expect-error get needs the id
  void q.songs.get.queryOptions({})
  // @ts-expect-error wrong input type
  void q.songs.get.queryOptions({ slug: 1 })
  // @ts-expect-error no such op
  void q.songs.nope
  const song: { slug: string; title: string } = await qc.fetchQuery(q.songs.get.queryOptions({ slug: 'a' }))
  const cached: { slug: string; title: string } | undefined = qc.getQueryData(q.songs.get.key({ slug: 'a' }))
  const titles = new QueryObserver(qc, q.songs.get.queryOptions({ slug: 'a' }, { select: (s) => s.title }))
  const title: string | undefined = titles.getCurrentResult().data
  const list: { slug: string }[] = await qc.fetchQuery(q.songs.list.queryOptions())
  const renamed = new MutationObserver(qc, q.songs.rename.mutationOptions())
  const out: { slug: string; title: string } = await renamed.mutate({ slug: 'a', title: 'x' })
  // @ts-expect-error rename needs a title
  void renamed.mutate({ slug: 'a' })
  void new MutationObserver(qc, q.songs.rename.mutationOptions({ onSuccess: (data) => data.title satisfies string }))
  return [song, cached, title, list, out]
}

test('keys are plain arrays from the contract; an empty input shares the no-input key', () => {
  assert.deepEqual(q.songs.get.key({ slug: 'a' }), ['onedef', 'songs', 'get', { slug: 'a' }])
  assert.deepEqual(q.songs.list.key(), ['onedef', 'songs', 'list'])
  assert.deepEqual(q.songs.list.queryOptions({}).queryKey, q.songs.list.queryOptions().queryKey)
  assert.deepEqual(q.songs.key(), ['onedef', 'songs'])
  assert.deepEqual(q.key(), ['onedef'])
  assert.deepEqual(q.songs.rename.mutationOptions().mutationKey, ['onedef', 'songs', 'rename'])
  assert.equal(q.songs.get.queryOptions({ slug: 'a' }, { staleTime: 30_000 }).staleTime, 30_000)
})

test('queryFn calls the client with TanStack’s abort signal', async () => {
  reset()
  const qc = new QueryClient()
  assert.deepEqual(await qc.fetchQuery(q.songs.get.queryOptions({ slug: 'a' })), { slug: 'a', title: 'A' })
  assert.ok(seenSignal instanceof AbortSignal)
  const observer = new QueryObserver(qc, q.songs.list.queryOptions({}, { select: (items) => items.length }))
  const result = await observer.refetch()
  assert.equal(result.data, 2)
})

test('a mutation returning the object writes it into get, and invalidates the rest of the service', async () => {
  reset()
  const qc = new QueryClient()
  await qc.fetchQuery(q.songs.get.queryOptions({ slug: 'a' }))
  await qc.fetchQuery(q.songs.get.queryOptions({ slug: 'b' }))
  await qc.fetchQuery(q.songs.list.queryOptions())
  await qc.fetchQuery(q.stats.total.queryOptions())
  await mutate(qc, q.songs.rename.mutationOptions(), { slug: 'a', title: 'A2' })
  assert.deepEqual(qc.getQueryData(q.songs.get.key({ slug: 'a' })), { slug: 'a', title: 'A2' })
  assert.equal(invalidated(qc, q.songs.get.key({ slug: 'a' })), false) // fresh: no refetch needed
  assert.equal(invalidated(qc, q.songs.list.key()), true)
  assert.equal(invalidated(qc, q.songs.get.key({ slug: 'b' })), true)
  assert.equal(invalidated(qc, q.stats.total.key()), false) // not affected
})

test('create seeds the new object’s get; a singleton action returning fields updates its get', async () => {
  reset()
  const qc = new QueryClient()
  await mutate(qc, q.songs.create.mutationOptions(), { title: 'C' })
  assert.deepEqual(qc.getQueryData(q.songs.get.key({ slug: 'c' })), { slug: 'c', title: 'C' })
  await qc.fetchQuery(q.account.get.queryOptions())
  await mutate(qc, q.account.rename.mutationOptions(), { name: 'grace' })
  assert.deepEqual(qc.getQueryData(q.account.get.key()), { name: 'grace' })
})

test('delete removes the member’s get and invalidates the list', async () => {
  reset()
  const qc = new QueryClient()
  await qc.fetchQuery(q.songs.get.queryOptions({ slug: 'a' }))
  await qc.fetchQuery(q.songs.list.queryOptions())
  await mutate(qc, q.songs.delete.mutationOptions(), { slug: 'a' })
  assert.equal(qc.getQueryState(q.songs.get.key({ slug: 'a' })), undefined)
  assert.equal(invalidated(qc, q.songs.list.key()), true)
})

test('affects invalidates the other service', async () => {
  reset()
  const qc = new QueryClient()
  await qc.fetchQuery(q.stats.total.queryOptions())
  await qc.fetchQuery(q.account.get.queryOptions())
  await mutate(qc, q.songs.play.mutationOptions(), { slug: 'a' })
  assert.equal(invalidated(qc, q.stats.total.key()), true)
  assert.equal(invalidated(qc, q.account.get.key()), false)
})

test('invalidate: false opts out; the user’s onSuccess runs after the cache update', async () => {
  reset()
  const qc = new QueryClient()
  await qc.fetchQuery(q.songs.get.queryOptions({ slug: 'a' }))
  await qc.fetchQuery(q.songs.list.queryOptions())
  const calls: string[] = []
  await mutate(
    qc,
    q.songs.rename.mutationOptions({
      invalidate: false,
      onSuccess: (data, variables, _result, context) => {
        assert.equal(context.client, qc)
        calls.push(`${variables.slug}:${data.title}`)
      },
    }),
    { slug: 'a', title: 'A2' },
  )
  assert.deepEqual(calls, ['a:A2'])
  assert.deepEqual(qc.getQueryData(q.songs.get.key({ slug: 'a' })), { slug: 'a', title: 'A' })
  assert.equal(invalidated(qc, q.songs.list.key()), false)

  await mutate(
    qc,
    q.songs.rename.mutationOptions({
      onSuccess: () => {
        calls.push(`list invalidated: ${invalidated(qc, q.songs.list.key())}`)
      },
    }),
    { slug: 'a', title: 'A3' },
  )
  assert.deepEqual(calls, ['a:A2', 'list invalidated: true'])
})
