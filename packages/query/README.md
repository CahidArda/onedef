# @onedef/query

TanStack Query for a onedef client. Every op gets options objects that every
TanStack Query v5 adapter accepts as they are (React, Vue, Solid, Svelte,
Angular). Cache invalidation comes from the contract, so you don't write
`onSuccess` handlers to refresh data.

```ts
import { createClient } from 'onedef'
import { rpc } from '@onedef/orpc/client'
import { createQueryUtils } from '@onedef/query'

export const client = createClient(contract, rpc({ url: '/api' }))
export const q = createQueryUtils(contract, client)

useQuery(q.songs.list.queryOptions())
useQuery(q.songs.get.queryOptions({ slug }, { staleTime: 30_000 })) // any query option, merged in
useMutation(q.songs.rename.mutationOptions()) // variables = the op's input: { slug, title }
```

- `queryOptions` exists only on query ops and `mutationOptions` only on
  mutation ops. Inputs and outputs are typed by the client (`InputOf` / `OutputOf`).
  TanStack's abort `signal` is passed through to the call.
- Keys are plain arrays: `q.songs.get.key({ slug })` is
  `['onedef', 'songs', 'get', { slug }]`, and `q.songs.get.key()` is the prefix
  of every `get`. An empty input is left out, so `list()` and `list({})` share
  a key. `q.songs.key()` is `['onedef', 'songs']` and `q.key()` is `['onedef']`.
  The keys are tagged, so `queryClient.getQueryData(q.songs.get.key({ slug }))` is typed.

## What a successful mutation updates

The cache is updated from the contract, in this order:

1. If the service is a `collection()` or `singleton()` and the mutation's
   `output` is the resource's `fields` schema (the same reference, as in
   `action({ output: Song })` or the default `create`), the returned object is
   written into that object's `get` query with `setQueryData`. The UI updates
   without waiting for a refetch.
2. A collection's `delete` removes that member's `get` query.
3. Every other query of the service, and of each service listed in `affects`,
   is invalidated.

Then your own `onSuccess` runs. Pass `mutationOptions({ invalidate: false })`
to skip steps 1 to 3. Nothing has to be wired up: TanStack passes the
`QueryClient` to mutation callbacks as `context.client`.

## Server-rendered data

Fetch on the server with an in-process client, then hand the result to the
query as `initialData`:

```tsx
// app/songs/[slug]/page.tsx (server component)
const server = createClient(contract, local(backend))
export default async function Page({ params }) {
  return <Song slug={params.slug} initial={await server.songs.get({ slug: params.slug })} />
}

// Song.tsx ('use client')
const { data } = useQuery({ ...q.songs.get.queryOptions({ slug }), initialData: initial })
```

To hydrate the whole cache instead, the same options work with
`queryClient.prefetchQuery(q.songs.get.queryOptions({ slug }))` followed by
`dehydrate(queryClient)` and `<HydrationBoundary>`.

## Caveat: scopes

Keys don't include tenancy scope values (a client's `scope` option, or a
per-call `{ scope }`). If one page can switch scopes (a team picker, for
example), clear the cache when the scope changes, or give each scope its own
`QueryClient`.
