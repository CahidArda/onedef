import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InfiniteQueryObserver, QueryClient } from '@tanstack/query-core'
import { collection, createClient, defineApi, defineConfig, fail, implement, local } from 'onedef'
import { z } from 'zod'
import { createQueryUtils } from '../src/index.js'

const Item = z.object({ id: z.string(), n: z.number() })
const config = defineConfig({ name: 't' })
const contract = defineApi(config, {
  items: collection(config, {
    name: 'items',
    description: '',
    id: 'id',
    fields: Item,
    list: { input: z.object({ even: z.boolean().optional() }), paginate: 'cursor' },
    delete: true,
  }),
})
let all = Array.from({ length: 7 }, (_, n) => ({ id: `i${n}`, n }))
const backend = implement(contract, {
  items: {
    list: ({ input }) => {
      const rows = all.filter((r) => !input.even || r.n % 2 === 0)
      const start = Number(input.cursor ?? 0)
      const end = start + (input.limit ?? 3)
      return { items: rows.slice(start, end), ...(end < rows.length ? { nextCursor: String(end) } : {}) }
    },
    get: ({ id }) => all.find((r) => r.id === id) ?? fail('NOT_FOUND'),
    delete: ({ id }) => void (all = all.filter((r) => r.id !== id)),
  },
})
const q = createQueryUtils(contract, createClient(contract, local(backend)))

test('infiniteQueryOptions pages through nextCursor and is invalidated by mutations', async () => {
  const queryClient = new QueryClient()
  const observer = new InfiniteQueryObserver(queryClient, q.items.list.infiniteQueryOptions({ limit: 3 }))
  let result = await observer.refetch()
  assert.deepEqual(
    result.data?.pages[0]?.items.map((r) => r.id),
    ['i0', 'i1', 'i2'],
  )
  assert.equal(observer.getCurrentResult().hasNextPage, true)
  result = await observer.fetchNextPage()
  result = await observer.fetchNextPage()
  assert.deepEqual(
    result.data?.pages.flatMap((p) => p.items.map((r) => r.n)),
    [0, 1, 2, 3, 4, 5, 6],
  )
  assert.equal(observer.getCurrentResult().hasNextPage, false)

  const filtered = await queryClient.fetchInfiniteQuery(q.items.list.infiniteQueryOptions({ even: true }))
  assert.deepEqual(
    filtered.pages[0]?.items.map((r) => r.n),
    [0, 2, 4],
  )

  const key = q.items.list.infiniteQueryOptions({ limit: 3 }).queryKey
  const del = q.items.delete.mutationOptions()
  await del.mutationFn!({ id: 'i0' }, { client: queryClient, meta: undefined } as any)
  await del.onSuccess!(undefined, { id: 'i0' }, undefined, { client: queryClient, meta: undefined } as any)
  assert.equal(queryClient.getQueryState(key)?.isInvalidated, true)
  // @ts-expect-error only paginated lists get infinite options
  void q.items.get.infiniteQueryOptions
})
