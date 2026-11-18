# @onedef/store

`implement()` with the persistence written for you. Give it the contract and a
**store**, and write only the handlers that hold logic: `list`, `get` and
`delete` are generated, `create` and actions just return the object. Start on
local files, move to Redis later; nothing else changes.

```ts
import { implementStore } from '@onedef/store'
import { fsStore } from '@onedef/store/fs'

export const backend = implementStore(contract, fsStore('.data'), {
  songs: {
    create: ({ input }) => ({ slug: slugify(input.title), title: input.title, plays: 0 }),
    rename: ({ object, input }) => ({ ...object, title: input.title }), // output: Song → written back
  },
  account: { initial: { name: 'guest' }, rename: ({ object, input }) => ({ ...object, name: input.name }) },
  stats: { ping: () => ({ ok: true }) }, // a plain defineService service: as in implement()
})

// later: import { Redis } from '@upstash/redis'; import { redisStore } from '@onedef/store/redis'
// implementStore(contract, redisStore(Redis.fromEnv()), { …the same handlers… })
```

The result is a plain `Backend`, so `toNextHandlers(backend)`,
`createMcpHandler(backend)`, `local(backend)` and every other surface work as
they are.

## What is generated

| service        | op                                                | generated behaviour                                                                                                        |
| -------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `collection()` | `get`                                             | the stored object; `NOT_FOUND` when missing                                                                                |
|                | `delete`                                          | removes it; `NOT_FOUND` when missing                                                                                       |
|                | `list`                                            | the objects in id order (see below)                                                                                        |
|                | `create`                                          | **yours**: return the new object. It is stored under its id field; `CONFLICT` when the id is taken (atomic in every store) |
| `singleton()`  | `get`                                             | the stored object, else `initial`, else `NOT_FOUND`                                                                        |
| both           | actions whose `output` is the resource's `fields` | **yours**: return the updated object, and it is written back                                                               |
| anything else  | other actions, `queries`, `defineService` ops     | **yours**, exactly as in `implement()`                                                                                     |

Every generated op can be overridden by passing a handler for it. Missing
handlers are compile errors and, like `implement()`, runtime errors.

**Write-back rule.** An action is written back exactly when its `output` is
the resource's `fields` schema (the same schema object: `output: Song` where
`fields: Song`). That is the rule `@onedef/query` uses to put an action's
result into the `get` cache, so the store and the client cache agree. Add
`needs: 'object'` to receive the current object (`({ object }) => ({ ...object, … })`).
A member action is stored under its id (changing the id field fails); a
collection-level action under the returned object's id (an upsert). An action
with any other output (`{ plays: number }`, nothing) is not written: close over
the store yourself if it must change data.

**Generated `list`.**

- Without `paginate`: the whole collection, in id order. Fine for files and
  small collections; paginate (or write `list`) for big ones.
- With `paginate: 'cursor'`: pages in id order, `limit` defaulting to 20,
  `nextCursor` the last id of the page.
- Filters: every list input field that is also an object field filters by
  equality when passed (`list: { input: z.object({ region: z.string().optional() }) }`
  → `list({ region: 'eu' })` keeps objects whose `region === 'eu'`). Paginated
  filtered pages stay full. A list input field that is _not_ an object field
  (`q`, `sort`, `minPlays`) cannot be generated: `list` then becomes a required
  handler (compile error and startup error).
- Items are the stored objects, validated against the list item schema (with
  zod, `summary` strips the extra fields).

Objects are validated against `fields` before every write, so the store only
holds valid objects. Values are JSON: a `Date` comes back as a string.

## Tenants

```ts
implementStore(contract, store, {
  context: async ({ request }) => ({ userId: await verify(request) }),
  partition: ({ ctx }) => ctx.userId, // every namespace becomes `<service>/<userId>`
  …
})
```

## Stores

| store                            | import                | notes                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `memoryStore()`                  | `@onedef/store`       | tests, demos                                                                                                                                                                                                                                                                                                                                     |
| `fsStore(dir)`                   | `@onedef/store/fs`    | Node. One pretty-printed JSON file per object at `dir/<service>/<id>.json` (a singleton is `_.json`). Atomic writes (temp file + rename). Ids are restricted to letters, digits and `_ - . @ ~ + =`, not starting with a dot: anything else, `../` included, fails `INVALID_INPUT`. One process; ids are case-insensitive on macOS/Windows disks |
| `redisStore(redis, { prefix? })` | `@onedef/store/redis` | an `@upstash/redis` `Redis` (optional peer dependency). Per namespace a hash (`id → JSON`) and a sorted set of ids for ordered listing; writes in one `MULTI`, creates with `HSETNX`                                                                                                                                                             |

A store is four async methods over JSON objects, so writing another is short:

```ts
interface Store {
  get(ns: string, id: string): Promise<StoredObject | undefined>
  put(ns: string, id: string, value: StoredObject, options?: { ifAbsent?: boolean }): Promise<boolean>
  delete(ns: string, id: string): Promise<boolean>
  list(
    ns: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: StoredObject[]; nextCursor?: string }>
}
```

`list` is in ascending id order and its cursor is the last id returned, so
cursors mean the same thing in every store.
