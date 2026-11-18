import type {
  DataTag,
  DefaultError,
  InfiniteData,
  MutationFunctionContext,
  MutationObserverOptions,
  QueryClient,
  QueryFunctionContext,
  QueryObserverOptions,
} from '@tanstack/query-core'
import type { AnyService, Api, ApiClient, OpInput, OpResult } from 'onedef'

/**
 * TanStack Query for a onedef client. Every op of the contract gets ready-made
 * options objects that every TanStack adapter accepts unchanged (React, Vue,
 * Solid, Svelte, Angular): `useQuery(q.songs.get.queryOptions({ slug }))`,
 * `useMutation(q.songs.rename.mutationOptions())`.
 *
 * Keys come from the contract (`['onedef', service, op, input]`), and so does
 * cache invalidation: the contract already says which service a mutation
 * changes, which other services it `affects`, and — for `collection()` /
 * `singleton()` services — when a mutation returns the whole object. So a
 * successful mutation updates and invalidates the right queries by itself.
 *
 * Only types are imported from `@tanstack/query-core`; the QueryClient is the
 * one TanStack hands every mutation callback (`context.client`), so there is
 * nothing to wire up.
 */

/** Every key starts with this, so `['onedef']` matches everything this package caches. */
export const KEY_ROOT = 'onedef'

/** The key of one op's query: `['onedef', service, op]`, plus the input when it is not empty. */
export type OpKey<TService extends string = string, TOp extends string = string, TInput = unknown> = readonly [
  typeof KEY_ROOT,
  TService,
  TOp,
  TInput?,
]
/** The key of everything cached for one service. */
export type ServiceKey<TService extends string = string> = readonly [typeof KEY_ROOT, TService]

type Services<TApi> = TApi extends Api<infer TServices, any> ? TServices : never
type Ops<TSvc> = TSvc extends { ops: infer TOps } ? TOps : never

/** What `queryOptions` accepts besides the input: any TanStack query option but `queryKey`/`queryFn`. */
export type QueryExtras<TOutput, TData = TOutput, TKey extends OpKey = OpKey> = Omit<
  QueryObserverOptions<TOutput, DefaultError, TData, TOutput, TKey>,
  'queryKey' | 'queryFn'
>

/**
 * What `queryOptions` returns: the options you passed, plus a typed (tagged) key and the `queryFn`.
 * Deliberately not the whole of core's `QueryObserverOptions`: adapters type some options their own
 * way (Vue's `enabled` is a getter), so returning only what was given keeps it assignable to every one.
 */
export type OpQueryOptions<TOutput, TKey extends OpKey = OpKey, TExtra = {}> = Omit<TExtra, 'queryKey' | 'queryFn'> & {
  queryKey: DataTag<TKey, TOutput, DefaultError>
  queryFn: (context: QueryFunctionContext<TKey>) => Promise<TOutput>
}

/** Mutation variables: the op's input, omittable when nothing in it is required. */
export type Variables<TInput> = {} extends TInput ? TInput | void : TInput

/** What `mutationOptions` accepts: any TanStack mutation option but `mutationFn`/`mutationKey`, plus `invalidate`. */
export type MutationExtras<TOutput, TVariables, TOnMutateResult = unknown> = Omit<
  MutationObserverOptions<TOutput, DefaultError, TVariables, TOnMutateResult>,
  'mutationFn' | 'mutationKey'
> & {
  /** `false` skips the contract-derived cache updates; your own `onSuccess` still runs. Default `true`. */
  invalidate?: boolean
}

/** What `mutationOptions` returns: plain TanStack mutation options. */
export type OpMutationOptions<TOutput, TVariables, TOnMutateResult = unknown, TKey = unknown> = Omit<
  MutationObserverOptions<TOutput, DefaultError, TVariables, TOnMutateResult>,
  'mutationFn' | 'mutationKey'
> & {
  mutationKey: TKey
  mutationFn: (variables: TVariables, context: MutationFunctionContext) => Promise<TOutput>
}

export interface QueryOpUtils<TService extends string, TOp extends string, TInput, TOutput> {
  /** This op's key; without an input, the prefix of every input's key (to invalidate them all). */
  key(input?: TInput): DataTag<OpKey<TService, TOp, TInput>, TOutput, DefaultError>
  /** Options for `useQuery` / `createQuery` / `fetchQuery` / `prefetchQuery`; `extra` is merged in. */
  queryOptions: {} extends TInput
    ? <TData = TOutput, TExtra extends object = {}>(
        input?: TInput,
        extra?: TExtra & QueryExtras<TOutput, TData, OpKey<TService, TOp, TInput>>,
      ) => OpQueryOptions<TOutput, OpKey<TService, TOp, TInput>, TExtra>
    : <TData = TOutput, TExtra extends object = {}>(
        input: TInput,
        extra?: TExtra & QueryExtras<TOutput, TData, OpKey<TService, TOp, TInput>>,
      ) => OpQueryOptions<TOutput, OpKey<TService, TOp, TInput>, TExtra>
}

/** Extra options for `infiniteQueryOptions`: anything but the parts it derives. */
export type InfiniteExtras = Record<string, unknown> & {
  queryKey?: never
  queryFn?: never
  initialPageParam?: never
  getNextPageParam?: never
}

/** Paginated (`paginate: 'cursor'`) list ops also get infinite-query options. */
export interface InfiniteOpUtils<TService extends string, TOp extends string, TInput, TOutput> {
  /**
   * Options for `useInfiniteQuery` / `createInfiniteQuery`: pages are fetched
   * with `cursor` = the previous page's `nextCursor`, until there is none.
   *
   *   const songs = useInfiniteQuery(q.songs.list.infiniteQueryOptions({ limit: 20 }))
   *   songs.data?.pages.flatMap((page) => page.items)
   */
  infiniteQueryOptions<TExtra extends InfiniteExtras = {}>(
    input?: Omit<TInput, 'cursor'>,
    extra?: TExtra,
  ): TExtra & {
    queryKey: DataTag<
      readonly [typeof KEY_ROOT, TService, TOp, 'infinite', ...unknown[]],
      InfiniteData<TOutput, string | undefined>,
      DefaultError
    >
    queryFn: (context: QueryFunctionContext<any, string | undefined>) => Promise<TOutput>
    initialPageParam: string | undefined
    getNextPageParam: (lastPage: TOutput) => string | undefined
  }
}

export interface MutationOpUtils<TService extends string, TOp extends string, TInput, TOutput> {
  /**
   * Options for `useMutation` / `createMutation`. Variables are the op's input.
   * After a success, the cache is updated from the contract, then your `onSuccess` runs.
   */
  mutationOptions<TOnMutateResult = unknown>(
    extra?: MutationExtras<TOutput, Variables<TInput>, TOnMutateResult>,
  ): OpMutationOptions<TOutput, Variables<TInput>, TOnMutateResult, readonly [typeof KEY_ROOT, TService, TOp]>
}

type OpUtils<TService extends string, TOp extends string, TSvc, TDef> = TDef extends { kind: 'query' }
  ? QueryOpUtils<TService, TOp, OpInput<TSvc, TDef>, OpResult<TDef>> &
      (TDef extends { paginate: 'cursor' } ? InfiniteOpUtils<TService, TOp, OpInput<TSvc, TDef>, OpResult<TDef>> : {})
  : MutationOpUtils<TService, TOp, OpInput<TSvc, TDef>, OpResult<TDef>>

export type ServiceQueryUtils<TService extends string, TSvc> = {
  [K in keyof Ops<TSvc> & string]: OpUtils<TService, K, TSvc, Ops<TSvc>[K]>
} & {
  /** Everything cached for this service: `['onedef', service]`. */
  key(): ServiceKey<TService>
}

/** `q.songs.get.queryOptions({ slug })`, `q.songs.rename.mutationOptions()`, `q.songs.key()`. */
export type QueryUtils<TApi> = {
  [K in keyof Services<TApi> & string]: ServiceQueryUtils<K, Services<TApi>[K]>
} & {
  /** Everything this package caches: `['onedef']`. */
  key(): readonly [typeof KEY_ROOT]
}

/**
 * TanStack Query options for every op of a contract, called through `client`:
 *
 *   export const client = createClient(contract, rpc({ url: '/api' }))
 *   export const q = createQueryUtils(contract, client)
 *
 *   useQuery(q.songs.get.queryOptions({ slug }, { staleTime: 30_000 }))
 *   useMutation(q.songs.rename.mutationOptions())   // get + list refresh themselves
 */
export function createQueryUtils<TApi extends Api<any, any>>(api: TApi, client: ApiClient<TApi>): QueryUtils<TApi> {
  const services = api.services as Record<string, AnyService>
  const calls = client as unknown as Record<
    string,
    Record<string, (input?: unknown, options?: object) => Promise<unknown>>
  >
  const root: Record<string, unknown> = { key: () => [KEY_ROOT] }
  for (const [service, svc] of Object.entries(services)) {
    if ('key' in svc.ops)
      throw new Error(`@onedef/query: ${service} has an op named "key", which q.${service}.key() needs`)
    const utils: Record<string, unknown> = { key: () => [KEY_ROOT, service] }
    for (const [op, def] of Object.entries(svc.ops)) {
      const call = (input: unknown, options?: object) => calls[service]![op]!(input ?? {}, options)
      const key = (input?: unknown) => opKey(service, op, input)
      utils[op] =
        def.kind === 'query'
          ? {
              key,
              queryOptions: (input?: unknown, extra?: object) => ({
                ...extra,
                queryKey: key(input),
                queryFn: ({ signal }: QueryFunctionContext) => call(input, { signal }),
              }),
              ...(def.paginate === 'cursor'
                ? {
                    infiniteQueryOptions: (input?: object, extra?: object) => ({
                      ...extra,
                      // under the op's prefix, so the contract-derived invalidation covers it
                      queryKey: [
                        KEY_ROOT,
                        service,
                        op,
                        'infinite',
                        ...(input && Object.keys(input).length ? [input] : []),
                      ],
                      queryFn: ({ signal, pageParam }: QueryFunctionContext<any, string | undefined>) =>
                        call({ ...input, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
                      initialPageParam: undefined,
                      getNextPageParam: (last: { nextCursor?: string }) => last?.nextCursor,
                    }),
                  }
                : {}),
            }
          : {
              mutationOptions: ({ invalidate = true, onSuccess, ...extra }: MutationExtras<any, any, any> = {}) => ({
                ...extra,
                mutationKey: [KEY_ROOT, service, op],
                mutationFn: (variables: unknown) => call(variables),
                onSuccess: async (
                  data: unknown,
                  variables: unknown,
                  onMutateResult: unknown,
                  context: MutationFunctionContext,
                ) => {
                  if (invalidate) await updateCache(context.client, services, service, op, data, variables)
                  return onSuccess?.(data, variables, onMutateResult, context)
                },
              }),
            }
    }
    root[service] = utils
  }
  return root as QueryUtils<TApi>
}

/**
 * The cache key of one op call — what every `queryOptions` uses. Exported so
 * other layers (an MCP App seeding the result of the tool call that opened it)
 * write exactly where a screen will read.
 */
export function opKey(service: string, op: string, input: unknown): OpKey {
  return isEmpty(input) ? [KEY_ROOT, service, op] : [KEY_ROOT, service, op, input]
}

function isEmpty(input: unknown): boolean {
  return input === undefined || (typeof input === 'object' && input !== null && Object.keys(input).length === 0)
}

/**
 * What the contract says a successful mutation changed:
 *  - it returned the whole object (`output` is the resource's `fields`): write it into that object's `get`;
 *  - it was a collection's `delete`: drop that member's `get`;
 *  - then invalidate every other query of the service and of each service in `affects`.
 */
async function updateCache(
  queryClient: QueryClient,
  services: Record<string, AnyService>,
  service: string,
  op: string,
  data: unknown,
  variables: unknown,
): Promise<void> {
  const svc = services[service]!
  const def = svc.ops[op]!
  const resource = svc.resource
  const vars = (variables ?? {}) as Record<string, unknown>
  let fresh: OpKey | undefined
  if (resource && svc.ops.get) {
    const idOf = (value: unknown) => (svc.id ? (value as Record<string, unknown> | null)?.[svc.id] : undefined)
    if (resource.kind === 'collection' && svc.id) {
      if (op === 'delete' && def.on === 'member') {
        queryClient.removeQueries({ queryKey: opKey(service, 'get', { [svc.id]: vars[svc.id] }), exact: true })
      } else if (def.output === resource.fields && data && typeof data === 'object') {
        // The returned object's own id first: a rename of the id field lands on the new key.
        const id = idOf(data) ?? (def.on === 'member' ? vars[svc.id] : undefined)
        if (id !== undefined) fresh = opKey(service, 'get', { [svc.id]: id })
      }
    } else if (resource.kind === 'singleton' && def.output === resource.fields && data && typeof data === 'object') {
      fresh = opKey(service, 'get', undefined)
    }
    if (fresh) queryClient.setQueryData(fresh, data)
  }
  const freshHash = fresh && JSON.stringify(fresh)
  const targets = [service, ...(def.affects ?? []).map((name) => serviceKeyOf(services, name))]
  await Promise.all(
    [...new Set(targets)].map((target) =>
      queryClient.invalidateQueries({
        queryKey: [KEY_ROOT, target],
        ...(freshHash ? { predicate: (query) => JSON.stringify(query.queryKey) !== freshHash } : {}),
      }),
    ),
  )
}

/** `affects` names services; accept the contract key or the service's `name`. */
function serviceKeyOf(services: Record<string, AnyService>, name: string): string {
  if (services[name]) return name
  return Object.entries(services).find(([, svc]) => svc.name === name)?.[0] ?? name
}
