import {
  fail,
  implement,
  toJsonSchema,
  type AnyOp,
  type AnyService,
  type Api,
  type ApiConfig,
  type Backend,
  type ContextArgs,
  type ImplementOptions,
  type Out,
  type ScopeValues,
  type ServiceHandlers,
  type ServiceMap,
} from 'onedef'
import { runsIn } from '@onedef/process'
import type { Store, StoredObject } from './store.js'

/** The id a singleton's object is stored under. */
export const SINGLETON_ID = '_'

/** Page size of a generated paginated `list` when the caller passes no `limit`. */
export const DEFAULT_LIMIT = 20

type MaybePromise<T> = T | Promise<T>
type OpsOf<TService> = TService extends { ops: infer TOps } ? TOps : never
/** `'collection'`, `'singleton'`, or `never` for a plain `defineService` service. */
type KindOf<TService> = TService extends { resource?: infer TResource }
  ? TResource extends { kind: infer TKind }
    ? TKind
    : never
  : never
type FieldsOf<TService> = TService extends { resource?: infer TResource }
  ? TResource extends { fields: infer TFields }
    ? Out<TFields>
    : never
  : never

/** The list input's own fields (without `cursor`/`limit`). */
type ListFilters<TService> =
  OpsOf<TService> extends { list: { input?: infer TInput } }
    ? [NonNullable<TInput>] extends [never]
      ? never
      : Exclude<keyof Out<NonNullable<TInput>>, 'cursor' | 'limit'>
    : never
/** A generated `list` can only filter on fields the object has; anything else needs a hand-written `list`. */
type ListIsGenerated<TService> = [ListFilters<TService>] extends [keyof FieldsOf<TService>] ? 'list' : never

/** The ops `implementStore()` writes for you (each may still be overridden). */
type Generated<TService> =
  KindOf<TService> extends 'collection'
    ? 'get' | 'delete' | ListIsGenerated<TService>
    : KindOf<TService> extends 'singleton'
      ? 'get'
      : never

type HasCreate<TService> =
  KindOf<TService> extends 'collection' ? ('create' extends keyof OpsOf<TService> ? 'create' : never) : never

type CreateArgs<THandler> = THandler extends (args: infer TArgs) => any ? TArgs : never

type CreateHandler<TApi extends Api, TCtx, TService> = [HasCreate<TService>] extends [never]
  ? {}
  : {
      /** Return the new object; the store writes it (CONFLICT when its id is taken) and `create` returns it. */
      create: (args: CreateArgs<CoreHandler<TApi, TCtx, TService, 'create'>>) => MaybePromise<FieldsOf<TService>>
    }

type SingletonExtras<TService> =
  KindOf<TService> extends 'singleton'
    ? {
        /**
         * What the generated `get` returns while nothing is stored yet (it is
         * not written until an action writes the object). Without it, `get`
         * fails NOT_FOUND. For a value that depends on the caller, write `get`.
         */
        initial?: FieldsOf<TService>
      }
    : {}

/** A process's `<op>Start` / `<op>Next`: answered by the process's own handler, never written. */
type Derived<TService> = {
  [K in keyof OpsOf<TService>]: OpsOf<TService>[K] extends { processOf: object } ? K : never
}[keyof OpsOf<TService>]

/** Ops without an `http` descriptor: `implement()` requires a handler for these. */
type RequiredOps<TService> = {
  [K in keyof OpsOf<TService>]: OpsOf<TService>[K] extends { http: object } | { processOf: object } ? never : K
}[keyof OpsOf<TService>]

/**
 * One op's handler, as `implement()` types it. Indexed per key rather than
 * `Omit`-ing core's (key-remapped) `ServiceHandlers` as a whole: with `Omit`,
 * handler parameters lost their contextual types inside the generic
 * `implementStore()` call.
 */
type CoreHandler<TApi extends Api, TCtx, TService, K> = ServiceHandlers<TApi, TCtx, TService>[K &
  keyof ServiceHandlers<TApi, TCtx, TService>]

/**
 * One service's handlers for `implementStore()`: exactly `implement()`'s,
 * except that `list` / `get` / `delete` of a collection and `get` of a
 * singleton are optional (generated from the store), and a collection's
 * `create` returns the object to store.
 */
export type StoreServiceHandlers<TApi extends Api, TCtx, TService> = {
  [K in Exclude<RequiredOps<TService>, Generated<TService> | HasCreate<TService>>]: CoreHandler<TApi, TCtx, TService, K>
} & {
  [
    K in Exclude<keyof OpsOf<TService>, RequiredOps<TService> | HasCreate<TService> | Derived<TService>> | Generated<TService>
  ]?: CoreHandler<TApi, TCtx, TService, K>
} & CreateHandler<TApi, TCtx, TService> &
  SingletonExtras<TService>

/** True when every op of the service is generated (or proxied), so its handlers may be left out entirely. */
type AllGenerated<TService> = [Exclude<RequiredOps<TService>, Generated<TService>>] extends [never] ? true : false

type ForService<
  TServices extends ServiceMap,
  TConfig extends ApiConfig,
  TCtx,
  K extends keyof TServices,
> = StoreServiceHandlers<Api<TServices, TConfig>, TCtx, TServices[K]>

/** Every service's handlers. A service whose ops are all generated may be left out. Mapped (not conditional), so `ctx` infers from `context()`. */
export type StoreHandlers<TServices extends ServiceMap, TConfig extends ApiConfig, TCtx> = {
  [K in keyof TServices as AllGenerated<TServices[K]> extends true ? never : K]: ForService<TServices, TConfig, TCtx, K>
} & {
  [K in keyof TServices as AllGenerated<TServices[K]> extends true ? K : never]?: ForService<
    TServices,
    TConfig,
    TCtx,
    K
  >
}

/** What `partition` receives. */
export interface PartitionArgs<TCtx> {
  /** The service's key in the contract. */
  service: string
  ctx: TCtx
  scope: ScopeValues
}

type AnyHandler = (args: any) => unknown
type Args = { id?: string; input?: unknown; ctx: unknown; scope: ScopeValues }

/**
 * `implement()`, with the persistence written for you. Give it a contract, a
 * {@link Store} and only the handlers that hold actual logic:
 *
 *   export const backend = implementStore(contract, fsStore('.data'), {
 *     songs: {
 *       create: ({ input }) => ({ slug: slugify(input.title), title: input.title, plays: 0 }),
 *       rename: ({ object, input }) => ({ ...object, title: input.title }),
 *     },
 *   })
 *
 * For a `collection()`:
 *   - `get` reads the object (NOT_FOUND when missing), `delete` removes it
 *     (NOT_FOUND when missing), `list` returns the objects in id order;
 *   - `list` honours `paginate: 'cursor'` (default page size 20) and filters by
 *     equality on every list input field that is also an object field and was
 *     passed (`{ region: 'eu' }` keeps objects whose `region === 'eu'`).
 *     Without `paginate`, it returns the whole collection. Anything smarter
 *     (search, ranges, sorting) — write `list` yourself;
 *   - `create` is yours and returns the new object; it is stored under its id
 *     field, and the call fails CONFLICT when that id is taken.
 * For a `singleton()`: `get` reads the stored object, else `initial`, else
 * fails NOT_FOUND.
 *
 * Actions whose `output` is the resource's `fields` schema (the same rule
 * `@onedef/query` uses to update its cache) return the updated object, and it
 * is written back — under the action's id for a member action, under the
 * returned object's id for a collection-level one. Combine with
 * `needs: 'object'` to get the current object first. Every other op —
 * actions with another output, extra `queries`, plain `defineService`
 * services — is a normal handler, exactly as in `implement()`.
 *
 * Every generated op can be overridden by passing a handler. Objects are
 * validated against `fields` before they are written, so the store only ever
 * holds valid objects. The result is a plain `Backend`: every surface works.
 *
 * Process runs (actions with `process: true`) are kept in the same store,
 * under `_runs`, unless you pass your own `runStore`.
 */
export function implementStore<TServices extends ServiceMap, TConfig extends ApiConfig, TCtx = undefined>(
  api: Api<TServices, TConfig>,
  store: Store,
  impl: {
    context?: (args: ContextArgs) => TCtx | Promise<TCtx>
    /**
     * Keep each tenant's or user's objects apart: every service's namespace
     * becomes `<service>/<partition>`. Must return a non-empty string.
     */
    partition?: (args: PartitionArgs<Awaited<TCtx>>) => string
  } & StoreHandlers<NoInfer<TServices>, NoInfer<TConfig>, Awaited<TCtx>>,
  options: ImplementOptions = {},
): Backend<Api<TServices, TConfig>> {
  const { context, partition, ...given } = impl as unknown as Record<string, Record<string, unknown>> & {
    context?: (args: ContextArgs) => unknown
    partition?: (args: PartitionArgs<unknown>) => string
  }
  const handlers: Record<string, unknown> = context ? { context } : {}
  for (const [key, svc] of Object.entries(api.services as ServiceMap)) {
    const own = (given[key] ?? {}) as Record<string, AnyHandler | undefined>
    const namespace = (args: Args) => {
      if (!partition) return key
      const part = partition({ service: key, ctx: args.ctx, scope: args.scope })
      if (typeof part !== 'string' || part === '')
        throw new Error(`@onedef/store: partition() for ${key} returned no string`)
      return `${key}/${part}`
    }
    handlers[key] = serviceHandlers(key, svc, own, store, namespace)
  }
  return implement(api, handlers as never, { ...options, runStore: options.runStore ?? runsIn(store) } as never)
}

function serviceHandlers(
  key: string,
  svc: AnyService,
  own: Record<string, AnyHandler | undefined>,
  store: Store,
  namespace: (args: Args) => string,
): Record<string, AnyHandler> {
  const resource = svc.resource
  const kind = resource?.kind
  const where = (name: string) => `${key}.${name}`
  const missing = (name: string, hint: string): never => {
    throw new Error(`@onedef/store: implementStore() is missing a handler for ${where(name)} (${hint})`)
  }
  const out: Record<string, AnyHandler> = {}

  const toStore = async (name: string, value: unknown): Promise<StoredObject> => {
    const parsed = await resource!.fields['~standard'].validate(value)
    if (parsed.issues) {
      const issues = parsed.issues.map((issue) => issue.message).join('; ')
      return fail('INTERNAL', `${where(name)} returned an object that does not match the fields of ${key}: ${issues}`)
    }
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
      return fail('INTERNAL', `${where(name)} must return an object`)
    }
    return parsed.value as StoredObject
  }
  const idOf = (name: string, object: StoredObject): string => {
    const id = object[svc.id!]
    if (typeof id !== 'string' || id === '') {
      return fail('INTERNAL', `${where(name)} returned an object without a string "${svc.id}"`)
    }
    return id
  }

  for (const [name, op] of Object.entries(svc.ops) as [string, AnyOp][]) {
    if (op.processOf) continue // `<op>Start` / `<op>Next` run the process's own handler
    const handler = own[name]
    const writesBack = resource !== undefined && op.output === resource.fields

    if (kind === 'collection' && name === 'list' && !handler) {
      if (!op.http) out.list = generatedList(key, svc, op, store, namespace)
    } else if (kind === 'collection' && name === 'get' && !handler) {
      if (!op.http)
        out.get = async (args: Args) =>
          (await store.get(namespace(args), args.id!)) ??
          fail('NOT_FOUND', `No ${svc.name} with ${svc.id} "${args.id}"`)
    } else if (kind === 'collection' && name === 'delete' && !handler) {
      if (!op.http)
        out.delete = async (args: Args) => {
          if (!(await store.delete(namespace(args), args.id!)))
            fail('NOT_FOUND', `No ${svc.name} with ${svc.id} "${args.id}"`)
        }
    } else if (kind === 'singleton' && name === 'get' && !handler) {
      const initial = (own as { initial?: unknown }).initial
      if (!op.http)
        out.get = async (args: Args) => {
          const stored = await store.get(namespace(args), SINGLETON_ID)
          if (stored) return stored
          return initial ?? fail('NOT_FOUND', `No ${svc.name} yet`)
        }
    } else if (kind === 'collection' && name === 'create') {
      if (!handler) missing(name, 'return the new object; the store writes it')
      out.create = async (args: Args) => {
        const object = await toStore(name, await handler!(args))
        const id = idOf(name, object)
        if (!(await store.put(namespace(args), id, object, { ifAbsent: true }))) {
          fail('CONFLICT', `${svc.name} with ${svc.id} "${id}" already exists`)
        }
        return object
      }
    } else if (writesBack && handler && op.kind === 'mutation') {
      out[name] = async (args: Args) => {
        const object = await toStore(name, await handler(args))
        if (kind === 'singleton') {
          await store.put(namespace(args), SINGLETON_ID, object)
        } else {
          const id = idOf(name, object)
          if (op.on === 'member' && id !== args.id) {
            fail('INTERNAL', `${where(name)} changed ${svc.id} from "${args.id}" to "${id}"; ids are fixed`)
          }
          await store.put(namespace(args), id, object)
        }
        return object
      }
    } else if (handler) {
      out[name] = handler
    } else if (!op.http) {
      missing(name, writesBack ? 'return the updated object; the store writes it back' : 'no store default for it')
    }
  }
  return out
}

function generatedList(
  key: string,
  svc: AnyService,
  op: AnyOp,
  store: Store,
  namespace: (args: Args) => string,
): AnyHandler {
  // Checked once, up front: a filter the generated list cannot apply must not be silently ignored.
  const fields = Object.keys(toJsonSchema(svc.resource!.fields, 'output').properties ?? {})
  const filters = Object.keys(toJsonSchema(op.input, 'input').properties ?? {}).filter(
    (name) => name !== 'cursor' && name !== 'limit',
  )
  const unknown = fields.length ? filters.filter((name) => !fields.includes(name)) : []
  if (unknown.length) {
    throw new Error(
      `@onedef/store: ${key}.list takes ${unknown.map((name) => `"${name}"`).join(', ')}, which ${unknown.length > 1 ? 'are not fields' : 'is not a field'} of ${svc.name}; ` +
        'the generated list only filters by equality on object fields — write a `list` handler',
    )
  }

  return async (args: Args) => {
    const { cursor, limit, ...rest } = (args.input ?? {}) as Record<string, unknown> & {
      cursor?: string
      limit?: number
    }
    const wanted = Object.entries(rest).filter(([, value]) => value !== undefined)
    const matches = (object: StoredObject) => wanted.every(([name, value]) => same(object[name], value))
    const ns = namespace(args)

    if (op.paginate !== 'cursor') return (await store.list(ns)).items.filter(matches)

    // Ask the store for exactly as many as are still missing, so its cursor
    // always points right after the last object looked at: filtered pages stay
    // full and nothing is skipped.
    const size = limit ?? DEFAULT_LIMIT
    const items: StoredObject[] = []
    let next = cursor
    do {
      const page = await store.list(ns, { ...(next !== undefined ? { cursor: next } : {}), limit: size - items.length })
      items.push(...page.items.filter(matches))
      next = page.nextCursor
    } while (next !== undefined && items.length < size)
    return next === undefined ? { items } : { items, nextCursor: next }
  }
}

/** Equality for filter values: `===` for primitives, structural for arrays and objects. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  return JSON.stringify(a) === JSON.stringify(b)
}
