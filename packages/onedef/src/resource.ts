import type { StandardSchemaV1 } from '@standard-schema/spec'
import {
  mutation,
  query,
  type AnyOp,
  type ApiConfig,
  type HttpDescriptor,
  type In,
  type ModeOf,
  type OpDef,
  type Out,
  type Result,
  type Schema,
  type ScopeOf,
  type ServiceDef,
} from './contract.js'
import { toJsonSchema } from './jsonschema.js'
import { withProcesses, type WithProcesses } from './process.js'

/**
 * Objects: the way most APIs are actually shaped. A `collection()` is many
 * objects addressed by an id (songs, databases); a `singleton()` is exactly one
 * (the account, the settings). Both compile down to ordinary ops, so every
 * surface works unchanged — what the object layer adds is convention:
 *
 *   collection  list  GET    /songs          songs_list     `songs list`
 *               get   GET    /songs/{slug}   songs_get      `songs get <slug>`
 *               create POST  /songs          songs_create   `songs create`        (optional)
 *               delete POST  /songs/{slug}/delete           destructive, --yes    (optional)
 *               actions      POST /songs/{slug}/<action>    your verbs
 *   singleton   get   GET    /account        account_get
 *               actions      POST /account/<action>
 *
 * and one capability ops alone do not have: an action can declare
 * `needs: 'object'`, and the backend loads the current object through `get`
 * before the handler runs.
 */

/** A list of `item` — a real Standard Schema (validates every element) that also reports its JSON Schema. */
export function arrayOf<TItem extends Schema>(item: TItem): StandardSchemaV1<In<TItem>[], Out<TItem>[]> {
  const jsonSchema = (io: 'input' | 'output') => () => ({ type: 'array', items: toJsonSchema(item, io) })
  return {
    '~standard': {
      version: 1,
      vendor: 'onedef',
      validate: async (value) => {
        if (!Array.isArray(value)) return { issues: [{ message: 'Expected an array' }] }
        const out: Out<TItem>[] = []
        for (const [index, element] of value.entries()) {
          const result = await item['~standard'].validate(element)
          if (result.issues) {
            return { issues: result.issues.map((issue) => ({ ...issue, path: [index, ...(issue.path ?? [])] })) }
          }
          out.push(result.value as Out<TItem>)
        }
        return { value: out }
      },
      jsonSchema: { input: jsonSchema('input'), output: jsonSchema('output') },
    } as StandardSchemaV1.Props<In<TItem>[], Out<TItem>[]>,
  }
}

/** One page of a paginated list. */
export interface Page<TItem> {
  items: TItem[]
  /** Pass back as `cursor` for the next page; absent on the last page. */
  nextCursor?: string
}

/** The page shape `list` returns when the collection is paginated. */
export function pageOf<TItem extends Schema>(item: TItem): StandardSchemaV1<Page<In<TItem>>, Page<Out<TItem>>> {
  const items = arrayOf(item)
  const jsonSchema = (io: 'input' | 'output') => () => ({
    type: 'object',
    properties: {
      items: toJsonSchema(items, io),
      nextCursor: { type: 'string', description: 'Pass as `cursor` to get the next page. Absent on the last page.' },
    },
    required: ['items'],
  })
  return {
    '~standard': {
      version: 1,
      vendor: 'onedef',
      validate: async (value) => {
        const page = value as Partial<Page<unknown>> | null
        if (!page || typeof page !== 'object')
          return { issues: [{ message: 'Expected a page { items, nextCursor? }' }] }
        const result = await items['~standard'].validate(page.items)
        if (result.issues)
          return { issues: result.issues.map((issue) => ({ ...issue, path: ['items', ...(issue.path ?? [])] })) }
        if (page.nextCursor !== undefined && typeof page.nextCursor !== 'string') {
          return { issues: [{ message: 'nextCursor must be a string', path: ['nextCursor'] }] }
        }
        return { value: { items: result.value, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) } }
      },
      jsonSchema: { input: jsonSchema('input'), output: jsonSchema('output') },
    } as StandardSchemaV1.Props<Page<In<TItem>>, Page<Out<TItem>>>,
  }
}

/** Paging parameters every paginated list accepts, next to its own filters. */
export interface Paging {
  /** From the previous page's `nextCursor`. */
  cursor?: string
  /** Page size, 1–100. The handler picks a default. */
  limit?: number
}

/** A list input widened with `cursor` and `limit`. */
export function withPaging<TInput extends Schema | undefined>(
  input: TInput,
): StandardSchemaV1<In<TInput> & Paging, Out<TInput> & Paging> {
  const jsonSchema = (io: 'input' | 'output') => () => {
    const inner = toJsonSchema(input, io)
    return {
      ...inner,
      type: 'object',
      properties: {
        ...(inner.properties ?? {}),
        cursor: { type: 'string', description: 'From the previous page’s nextCursor. Omit for the first page.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Page size.' },
      },
    }
  }
  return {
    '~standard': {
      version: 1,
      vendor: 'onedef',
      validate: async (value) => {
        const { cursor, limit, ...rest } = (value ?? {}) as Record<string, unknown>
        if (cursor !== undefined && typeof cursor !== 'string')
          return { issues: [{ message: 'cursor must be a string', path: ['cursor'] }] }
        const size = typeof limit === 'string' ? Number(limit) : limit
        if (size !== undefined && (!Number.isInteger(size) || (size as number) < 1 || (size as number) > 100)) {
          return { issues: [{ message: 'limit must be an integer from 1 to 100', path: ['limit'] }] }
        }
        let parsed: unknown = rest
        if (input) {
          const result = await input['~standard'].validate(rest)
          if (result.issues) return result
          parsed = result.value
        }
        return {
          value: {
            ...(parsed as object),
            ...(cursor !== undefined ? { cursor } : {}),
            ...(size !== undefined ? { limit: size } : {}),
          } as Out<TInput> & Paging,
        }
      },
      jsonSchema: { input: jsonSchema('input'), output: jsonSchema('output') },
    } as StandardSchemaV1.Props<In<TInput> & Paging, Out<TInput> & Paging>,
  }
}

type PageSchema<TItem> = TItem extends Schema ? StandardSchemaV1<Page<In<TItem>>, Page<Out<TItem>>> : never
type PagedInput<TInput> = StandardSchemaV1<In<TInput> & Paging, Out<TInput> & Paging>

type ArrayOf<TItem> = TItem extends Schema ? StandardSchemaV1<In<TItem>[], Out<TItem>[]> : never

/** Options every generated op accepts. */
interface OpOptions<TScope extends string, TMode extends string> {
  summary?: string
  description?: string
  scope?: readonly TScope[]
  modes?: readonly TMode[]
  http?: HttpDescriptor
}

/** A verb on an object (or on the collection): rename, reset, publish, translate… */
export interface ActionDef<
  TInput extends Schema | undefined = Schema | undefined,
  TOutput extends Schema | undefined = Schema | undefined,
  TNeeds extends 'object' | undefined = 'object' | undefined,
  TOn extends 'member' | 'collection' | undefined = 'member' | 'collection' | undefined,
  TProcess extends true | undefined = true | undefined,
> {
  summary: string
  description?: string
  input?: TInput
  /** What the action returns. Return the updated object (`output: Fields`) so clients can update caches directly. */
  output?: TOutput
  /** Load the current object first and pass it to the handler as `object`. */
  needs?: TNeeds
  /** Collection resources only: `'collection'` for an action on the whole collection (default `'member'`). */
  on?: TOn
  /**
   * A process: the handler may take many steps (`step`, `elicitAgentInput`). Calling
   * the action runs it end to end; `<action>Start` / `<action>Next` let an
   * agent do the work step by step. `implement()` then needs a `runStore`.
   */
  process?: TProcess
  destructive?: boolean
  idempotent?: boolean
  scope?: readonly string[]
  modes?: readonly string[]
  /** Other services whose cached reads this action changes. */
  affects?: readonly string[]
  http?: HttpDescriptor<Out<TInput> & Record<string, unknown>, Result<TOutput>>
  route?: AnyOp['route']
  cli?: AnyOp['cli']
  mcp?: AnyOp['mcp']
}

/** Declare an action. A helper (rather than a bare object) so `http` callbacks are typed from `input`. */
export function action<
  TInput extends Schema | undefined = undefined,
  TOutput extends Schema | undefined = undefined,
  const TNeeds extends 'object' | undefined = undefined,
  // undefined = "not given": collections then default to member, singletons to collection
  const TOn extends 'member' | 'collection' | undefined = undefined,
  const TProcess extends true | undefined = undefined,
>(
  def: ActionDef<TInput, TOutput, TNeeds, TOn, TProcess>,
): ActionDef<NoInfer<TInput>, NoInfer<TOutput>, NoInfer<TNeeds>, NoInfer<TOn>, NoInfer<TProcess>> {
  return def
}

type AnyAction = ActionDef<any, any, 'object' | undefined, 'member' | 'collection' | undefined, true | undefined>

/** An action, as the op it compiles to. */
/** A field of an action definition, or `undefined` when it was not given (structural `infer` would give `any`). */
type Field<T, K extends string> = T extends { [P in K]?: infer V }
  ? [NonNullable<V>] extends [never]
    ? undefined
    : NonNullable<V>
  : undefined

type ActionOp<TAction, TOnDefault extends 'member' | 'collection'> = OpDef<
  'mutation',
  Field<TAction, 'on'> extends 'member' | 'collection' ? Field<TAction, 'on'> : TOnDefault,
  Field<TAction, 'input'> & (Schema | undefined),
  Field<TAction, 'output'> & (Schema | undefined)
> &
  (Field<TAction, 'needs'> extends 'object' ? { needs: 'object' } : {}) &
  (Field<TAction, 'process'> extends true ? { process: true } : {})

type ActionOps<TActions, TOnDefault extends 'member' | 'collection'> = {
  [K in keyof TActions]: ActionOp<TActions[K], TOnDefault>
}

type CreateDef<TInput extends Schema | undefined, TOutput extends Schema | undefined> = {
  input?: TInput
  /** What create returns. Default: the object (`fields`). */
  output?: TOutput
} & OpOptions<string, string>

/** Omitted `actions`/`queries` can infer as their `Record<string, …>` constraint; that index signature must not reach the op map. */
type Known<T> = string extends keyof T ? {} : T

type ListItem<TFields, TSummary> = [TSummary] extends [Schema] ? TSummary : TFields

type CollectionOps<TFields, TSummary, TListInput, TPaginate, TCreate, TDelete, TActions, TQueries> = {
  list: TPaginate extends 'cursor'
    ? OpDef<'query', 'collection', PagedInput<TListInput>, PageSchema<ListItem<TFields, TSummary>>> & {
        paginate: 'cursor'
      }
    : OpDef<'query', 'collection', TListInput & (Schema | undefined), ArrayOf<ListItem<TFields, TSummary>>>
  get: OpDef<'query', 'member', undefined, TFields & Schema>
} & (TCreate extends CreateDef<infer TInput, infer TOutput>
  ? { create: OpDef<'mutation', 'collection', TInput, [TOutput] extends [Schema] ? TOutput : TFields & Schema> }
  : {}) &
  (TDelete extends true | OpOptions<string, string>
    ? { delete: OpDef<'mutation', 'member', undefined, undefined> }
    : {}) &
  ActionOps<Known<TActions>, 'member'> &
  Known<TQueries>

/**
 * Many objects addressed by an id. `list` and `get` always exist; `create` and
 * `delete` when you declare them; `actions` and extra `queries` as you like.
 *
 *   export const songs = collection(config, {
 *     name: 'songs',
 *     description: 'French song lessons.',
 *     id: 'slug',
 *     fields: Song,
 *     summary: SongSummary,
 *     create: { input: CreateSong },
 *     delete: true,
 *     actions: {
 *       rename: action({ summary: 'Rename a song', input: z.object({ title: z.string() }), output: Song, needs: 'object' }),
 *     },
 *   })
 */
export function collection<
  const TConfig extends ApiConfig,
  TFields extends Schema,
  const TId extends keyof Out<TFields> & string,
  TSummary extends Schema | undefined = undefined,
  TListInput extends Schema | undefined = undefined,
  const TPaginate extends 'cursor' | undefined = undefined,
  TCreate extends CreateDef<any, any> | undefined = undefined,
  TDelete extends true | OpOptions<ScopeOf<TConfig>, ModeOf<TConfig>> | undefined = undefined,
  const TActions extends Record<string, AnyAction> = {},
  const TQueries extends Record<
    string,
    OpDef<'query', 'collection' | 'member', any, any, ScopeOf<TConfig>, ModeOf<TConfig>>
  > = {},
>(
  config: TConfig,
  def: {
    name: string
    description: string
    id: TId
    /** The object's shape — what `get` returns, and what `needs: 'object'` actions receive. */
    fields: TFields
    /** The list item shape, when list returns less than `get` (no secrets, no heavy fields). */
    summary?: TSummary
    /**
     * List parameters: `input` for filters/search, and `paginate: 'cursor'` to
     * return `{ items, nextCursor }` pages (adds `cursor` and `limit` to the input).
     */
    list?: OpOptions<ScopeOf<TConfig>, ModeOf<TConfig>> & { input?: TListInput; paginate?: TPaginate }
    get?: OpOptions<ScopeOf<TConfig>, ModeOf<TConfig>>
    create?: TCreate
    delete?: TDelete
    actions?: TActions
    /** Extra read-only ops (search, stats…), built with `query()`. */
    queries?: TQueries
    /** Tenancy scopes every op of this collection runs in (an action's own `scope` wins). */
    scope?: readonly ScopeOf<TConfig>[]
    modes?: readonly ModeOf<TConfig>[]
    /** Fields only some modes may see. */
    restrict?: Partial<Record<keyof Out<TFields> & string, readonly ModeOf<TConfig>[]>>
  },
): ServiceDef<
  WithProcesses<CollectionOps<TFields, TSummary, TListInput, TPaginate, TCreate, TDelete, TActions, TQueries>>,
  TId,
  { kind: 'collection'; fields: TFields; summary?: Schema }
> {
  void config
  const label = def.name
  const scoped = <TOp extends AnyOp>(op: TOp, own?: readonly string[]): TOp =>
    own || def.scope ? ({ ...op, scope: own ?? def.scope } as TOp) : op
  const ops: Record<string, AnyOp> = {
    list: scoped(
      query({
        summary: def.list?.summary ?? `List ${label}`,
        ...pick(def.list),
        ...(def.list?.paginate
          ? {
              input: withPaging(def.list.input),
              output: pageOf((def.summary ?? def.fields) as Schema),
              paginate: 'cursor',
            }
          : {
              ...(def.list?.input ? { input: def.list.input } : {}),
              output: arrayOf((def.summary ?? def.fields) as Schema),
            }),
      } as never) as AnyOp,
      def.list?.scope,
    ),
    get: scoped(
      query({
        on: 'member',
        summary: def.get?.summary ?? `Get one of ${label} by ${def.id}`,
        ...pick(def.get),
        output: def.fields,
      } as never) as AnyOp,
      def.get?.scope,
    ),
  }
  if (def.create) {
    const create = def.create as CreateDef<Schema | undefined, Schema | undefined>
    ops.create = scoped(
      mutation({
        summary: create.summary ?? `Create one of ${label}`,
        ...pick(create),
        ...(create.input ? { input: create.input } : {}),
        output: create.output ?? def.fields,
      } as never) as AnyOp,
      create.scope,
    )
  }
  if (def.delete) {
    const options: OpOptions<string, string> = def.delete === true ? {} : def.delete
    ops.delete = scoped(
      mutation({
        on: 'member',
        summary: options.summary ?? `Delete one of ${label} permanently`,
        ...pick(options),
        destructive: true,
        idempotent: true,
      } as never) as AnyOp,
      options.scope,
    )
  }
  for (const [name, spec] of Object.entries(def.actions ?? {})) {
    if (ops[name]) throw new Error(`onedef: ${label} has both a built-in op and an action named "${name}"`)
    ops[name] = scoped(actionOp(spec, 'member'), spec.scope)
  }
  for (const [name, op] of Object.entries(def.queries ?? {})) {
    if (ops[name]) throw new Error(`onedef: ${label} has both a built-in op and a query named "${name}"`)
    ops[name] = scoped(op as AnyOp, (op as AnyOp).scope)
  }
  return {
    name: def.name,
    description: def.description,
    id: def.id,
    ops: withProcesses(def.name, ops),
    ...(def.modes ? { modes: def.modes } : {}),
    ...(def.restrict ? { restrict: def.restrict as Record<string, readonly string[]> } : {}),
    resource: { kind: 'collection', fields: def.fields, ...(def.summary ? { summary: def.summary } : {}) },
  } as never
}

type SingletonOps<TFields, TActions, TQueries> = {
  get: OpDef<'query', 'collection', undefined, TFields & Schema>
} & ActionOps<Known<TActions>, 'collection'> &
  Known<TQueries>

/**
 * Exactly one object: the account, the settings, the current plan. It cannot
 * be listed, created or deleted — it has a `get` and whatever `actions` you
 * declare, none of which take an id.
 *
 *   export const account = singleton(config, {
 *     name: 'account',
 *     description: 'The signed-in user.',
 *     fields: Account,
 *     actions: { rename: action({ summary: 'Change your display name', input: z.object({ name: z.string() }), output: Account }) },
 *   })
 */
export function singleton<
  const TConfig extends ApiConfig,
  TFields extends Schema,
  const TActions extends Record<string, ActionDef<any, any, 'object' | undefined, 'collection' | undefined, true | undefined>> = {},
  const TQueries extends Record<string, OpDef<'query', 'collection', any, any, ScopeOf<TConfig>, ModeOf<TConfig>>> = {},
>(
  config: TConfig,
  def: {
    name: string
    description: string
    fields: TFields
    get?: OpOptions<ScopeOf<TConfig>, ModeOf<TConfig>>
    actions?: TActions
    queries?: TQueries
    scope?: readonly ScopeOf<TConfig>[]
    modes?: readonly ModeOf<TConfig>[]
    restrict?: Partial<Record<keyof Out<TFields> & string, readonly ModeOf<TConfig>[]>>
  },
): ServiceDef<WithProcesses<SingletonOps<TFields, TActions, TQueries>>, never, { kind: 'singleton'; fields: TFields }> {
  void config
  const scoped = <TOp extends AnyOp>(op: TOp, own?: readonly string[]): TOp =>
    own || def.scope ? ({ ...op, scope: own ?? def.scope } as TOp) : op
  const ops: Record<string, AnyOp> = {
    get: scoped(
      query({
        summary: def.get?.summary ?? `Get the ${def.name}`,
        ...pick(def.get),
        output: def.fields,
      } as never) as AnyOp,
      def.get?.scope,
    ),
  }
  for (const [name, spec] of Object.entries(def.actions ?? {})) {
    if (ops[name]) throw new Error(`onedef: ${def.name} has both a built-in op and an action named "${name}"`)
    if ((spec.on as string | undefined) === 'member')
      throw new Error(`onedef: ${def.name}.${name} — a singleton has no members`)
    ops[name] = scoped(actionOp(spec, 'collection'), spec.scope)
  }
  for (const [name, op] of Object.entries(def.queries ?? {})) ops[name] = scoped(op as AnyOp, (op as AnyOp).scope)
  return {
    name: def.name,
    description: def.description,
    ops: withProcesses(def.name, ops),
    ...(def.modes ? { modes: def.modes } : {}),
    ...(def.restrict ? { restrict: def.restrict as Record<string, readonly string[]> } : {}),
    resource: { kind: 'singleton', fields: def.fields },
  } as never
}

/** The op-level options worth carrying over verbatim. */
function pick(options: OpOptions<string, string> | undefined): Partial<AnyOp> {
  if (!options) return {}
  const { description, modes, http } = options
  return { ...(description ? { description } : {}), ...(modes ? { modes } : {}), ...(http ? { http } : {}) }
}

function actionOp(spec: AnyAction, on: 'member' | 'collection'): AnyOp {
  const { on: own, needs, affects, input, output, ...rest } = spec
  return {
    ...rest,
    kind: 'mutation',
    on: own ?? on,
    ...(input ? { input } : {}),
    ...(output ? { output } : {}),
    ...(needs ? { needs } : {}),
    ...(affects ? { affects } : {}),
  } as AnyOp
}
