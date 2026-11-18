import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { AuthConfig } from './auth.js'
import { ApiError } from './errors.js'
import { withProcesses, type WithProcesses } from './process.js'

/**
 * The contract: what the API is, with no idea how it is answered. It is a
 * runtime value because every surface needs its schemas (JSON Schema for MCP
 * tools, CLI flags, OpenAPI), but it holds no server code — handlers attach
 * separately via `implement()`, so a client, CLI or SDK bundle that imports
 * the contract can never pull a backend function in with it.
 */

export type Schema = StandardSchemaV1
/** The validated (parsed) type of a schema; `{}` when there is none. */
export type Out<TSchema> = [TSchema] extends [StandardSchemaV1] ? StandardSchemaV1.InferOutput<TSchema> : {}
/** What a caller may pass for a schema; `{}` when there is none. */
export type In<TSchema> = [TSchema] extends [StandardSchemaV1] ? StandardSchemaV1.InferInput<TSchema> : {}
/** The result type of an op; `unknown` when it declares no output. */
export type Result<TSchema> = [TSchema] extends [StandardSchemaV1] ? StandardSchemaV1.InferOutput<TSchema> : unknown

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Where an op lives on an existing REST API. With one, the op needs no handler:
 * clients, the CLI and MCP can call that API directly (`http()` transport), and
 * a backend that does not implement the op proxies it.
 */
export interface HttpDescriptor<TInput = any, TResult = any> {
  method: HttpMethod
  /** May contain `{id}` (the member id) and any `{field}` of the input. */
  path: string
  headers?: (a: { input: TInput }) => Record<string, string>
  query?: (a: { input: TInput }) => Record<string, string | number | boolean | undefined>
  /** Request body; defaults to the input minus path parameters. Ignored for GET/DELETE. */
  body?: (a: { input: TInput }) => unknown
  /** Map the upstream payload onto the declared output. Without this you inherit the upstream's warts. */
  select?: (raw: any) => TResult
  /** Map upstream status codes onto your error codes, e.g. `{ 404: 'NOT_FOUND' }`. */
  errors?: Record<number, string>
}

export type OpKind = 'query' | 'mutation'

/** One operation. Build with `query()` or `mutation()`. */
export interface OpDef<
  TKind extends OpKind = OpKind,
  TOn extends 'collection' | 'member' = 'collection' | 'member',
  TInput extends Schema | undefined = Schema | undefined,
  TOutput extends Schema | undefined = Schema | undefined,
  TScope extends string = string,
  TMode extends string = string,
> {
  kind: TKind
  /** `'member'` ops are addressed by the service's `id`; `'collection'` (default) ops are not. */
  on: TOn
  /** One line. Becomes the OpenAPI summary, CLI help and MCP tool title. */
  summary: string
  description?: string
  input?: TInput
  output?: TOutput
  /** The op already exists on a REST API — see `HttpDescriptor`. */
  http?: HttpDescriptor<Out<TInput> & Record<string, unknown>, Result<TOutput>>
  /** Tenancy scopes this op runs in, from the config's `scopes`. */
  scope?: readonly TScope[]
  /** Credential modes allowed to call this op, from the config's `modes`. Absent = all. */
  modes?: readonly TMode[]
  /** Cannot be undone: MCP destructiveHint, CLI requires `--yes`. */
  destructive?: boolean
  idempotent?: boolean
  /** Override the generated REST route. */
  route?: { method?: HttpMethod; path?: string }
  cli?: { command?: string }
  mcp?: { expose?: boolean; name?: string }
  /**
   * `'object'`: the backend loads the object (through the service's `get`)
   * before the handler runs and passes it as `object` — one round trip, the
   * same on every surface. Set by `action({ needs: 'object' })`.
   */
  needs?: 'object'
  /** Other services whose cached reads this op changes (client caches invalidate them too). */
  affects?: readonly string[]
  /** `'cursor'`: input takes `cursor`/`limit`, output is `{ items, nextCursor }` (infinite queries, CLI paging). */
  paginate?: 'cursor'
  /**
   * A mutation whose handler may take many steps (`step`, `elicitAgentInput`): calling
   * it runs it end to end on the server, and `<op>Start` / `<op>Next` are
   * derived so an agent can do the work step by step. See `ProcessTools`.
   */
  process?: true
  /** Set on the derived `<op>Start` / `<op>Next` ops: which process, which step. */
  processOf?: { op: string; step: 'start' | 'next' }
}

export type AnyOp = OpDef<OpKind, 'collection' | 'member', any, any, string, string>

type OpOptions<TOn, TInput, TOutput, TScope extends string, TMode extends string> = Omit<
  OpDef<
    OpKind,
    TOn & ('collection' | 'member'),
    TInput & (Schema | undefined),
    TOutput & (Schema | undefined),
    TScope,
    TMode
  >,
  'kind' | 'on' | 'processOf'
> & { on?: TOn }

type WithHttp<TInput, TOutput> = { http: HttpDescriptor<Out<TInput> & Record<string, unknown>, Result<TOutput>> }

/**
 * A read-only op: GET, no confirmation, MCP `readOnlyHint`. Give it an `http`
 * descriptor when it already exists on a REST API; leave it out and attach a
 * handler with `implement()`.
 */
export function query<
  const TOn extends 'collection' | 'member' = 'collection',
  TInput extends Schema | undefined = undefined,
  TOutput extends Schema | undefined = undefined,
  const TScope extends string = never,
  const TMode extends string = never,
>(
  def: OpOptions<TOn, TInput, TOutput, TScope, TMode> & WithHttp<TInput, TOutput>,
): OpDef<'query', NoInfer<TOn>, NoInfer<TInput>, NoInfer<TOutput>, NoInfer<TScope>, NoInfer<TMode>> &
  WithHttp<NoInfer<TInput>, NoInfer<TOutput>>
export function query<
  const TOn extends 'collection' | 'member' = 'collection',
  TInput extends Schema | undefined = undefined,
  TOutput extends Schema | undefined = undefined,
  const TScope extends string = never,
  const TMode extends string = never,
>(
  def: OpOptions<TOn, TInput, TOutput, TScope, TMode>,
): OpDef<'query', NoInfer<TOn>, NoInfer<TInput>, NoInfer<TOutput>, NoInfer<TScope>, NoInfer<TMode>>
export function query(def: OpOptions<any, any, any, string, string>): AnyOp {
  return { on: 'collection', ...def, kind: 'query' } as AnyOp
}

/**
 * An op with side effects: POST by default. `http` works as for `query`.
 * `process: true` makes it a process (see `OpDef.process`).
 */
export function mutation<
  const TOn extends 'collection' | 'member' = 'collection',
  TInput extends Schema | undefined = undefined,
  TOutput extends Schema | undefined = undefined,
  const TScope extends string = never,
  const TMode extends string = never,
>(
  def: OpOptions<TOn, TInput, TOutput, TScope, TMode> & WithHttp<TInput, TOutput> & { process?: undefined },
): OpDef<'mutation', NoInfer<TOn>, NoInfer<TInput>, NoInfer<TOutput>, NoInfer<TScope>, NoInfer<TMode>> &
  WithHttp<NoInfer<TInput>, NoInfer<TOutput>>
export function mutation<
  const TOn extends 'collection' | 'member' = 'collection',
  TInput extends Schema | undefined = undefined,
  TOutput extends Schema | undefined = undefined,
  const TScope extends string = never,
  const TMode extends string = never,
>(
  def: OpOptions<TOn, TInput, TOutput, TScope, TMode> & { process: true; http?: undefined },
): OpDef<'mutation', NoInfer<TOn>, NoInfer<TInput>, NoInfer<TOutput>, NoInfer<TScope>, NoInfer<TMode>> & {
  process: true
}
export function mutation<
  const TOn extends 'collection' | 'member' = 'collection',
  TInput extends Schema | undefined = undefined,
  TOutput extends Schema | undefined = undefined,
  const TScope extends string = never,
  const TMode extends string = never,
>(
  def: OpOptions<TOn, TInput, TOutput, TScope, TMode>,
): OpDef<'mutation', NoInfer<TOn>, NoInfer<TInput>, NoInfer<TOutput>, NoInfer<TScope>, NoInfer<TMode>>
export function mutation(def: OpOptions<any, any, any, string, string>): AnyOp {
  return { on: 'collection', ...def, kind: 'mutation' } as AnyOp
}

/** A tenancy dimension a call happens in — a team, an org, a project. */
export interface ScopeDef {
  /** Header carrying the scope value, e.g. `Upstash-Team-Id`. */
  header: string
  description: string
  /**
   * Fail fast when an op declaring this scope has no value. Leave false only
   * when the upstream has a sane default: the failure mode is a
   * plausible-looking wrong-tenant response, not an error.
   */
  required?: boolean
}

export type ScopeRegistry = Record<string, ScopeDef>

export interface ApiConfig {
  /** Short machine name: the MCP server name, the CLI binary, the default tool prefix. */
  name: string
  /** One paragraph on what the API is for. MCP server instructions and the docs intro. */
  description?: string
  version?: string
  scopes?: ScopeRegistry
  /** Credential modes the API distinguishes, for `modes`/`fields` gating and `forMode()`. */
  modes?: readonly string[]
  /** How callers authenticate. Drives CLI login, MCP protection and header parsing. */
  auth?: AuthConfig
  /** Default base URL of the existing REST API that `http` descriptors point at. */
  baseUrl?: string
  /** Prefix for MCP tool names, e.g. `upstash` → `upstash_redis_list`. Default: none. */
  toolPrefix?: string
}

/** What `collection()` / `singleton()` record about the object a service manages. */
export interface ResourceInfo<TFields extends Schema = Schema> {
  kind: 'collection' | 'singleton'
  /** The object's shape — what `get` returns. */
  fields: TFields
  /** The list item shape, when it differs from `fields`. */
  summary?: Schema
}

export interface ServiceDef<
  TOps extends Record<string, AnyOp> = Record<string, AnyOp>,
  TId extends string = string,
  TResource extends ResourceInfo | undefined = ResourceInfo | undefined,
> {
  name: string
  /** Service-level prose: MCP tool context and the docs page intro. */
  description: string
  /** The input field member ops are addressed by, e.g. `slug` or `database_id`. */
  id?: TId
  ops: TOps
  /** Credential modes allowed to see this service at all. Absent = all. */
  modes?: readonly string[]
  /** Fields only some modes may see, stripped from every op output (schema and value). */
  restrict?: Record<string, readonly string[]>
  /** Set when the service was declared with `collection()` or `singleton()`. */
  resource?: TResource
}

export type AnyService = ServiceDef<Record<string, AnyOp>, string, ResourceInfo | undefined>
export type ServiceMap = Record<string, AnyService>

export interface Api<TServices extends ServiceMap = ServiceMap, TConfig extends ApiConfig = ApiConfig> {
  config: TConfig
  services: TServices
}

/** Identity at runtime; `const` keeps scope and mode names literal for checking. */
export function defineConfig<const TConfig extends ApiConfig>(config: TConfig): TConfig {
  return config
}

export type ScopeOf<TConfig extends ApiConfig> = keyof TConfig['scopes'] & string
export type ModeOf<TConfig extends ApiConfig> = TConfig['modes'] extends readonly (infer TMode extends string)[]
  ? TMode
  : string
type Elem<T> = T extends readonly (infer TItem)[] ? TItem : T
/** Every field any op of the service can return — what `restrict` may name. */
export type FieldsOf<TOps extends Record<string, AnyOp>> = {
  [K in keyof TOps]: keyof Elem<Out<NonNullable<TOps[K]['output']>>>
}[keyof TOps] &
  string

/**
 * Declare a service against the config. Identity at runtime; the config
 * argument is what checks, right where the service is written, that every
 * scope and mode named by its ops exists and that `restrict` names real fields.
 */
export function defineService<
  const TConfig extends ApiConfig,
  const TOps extends Record<
    string,
    OpDef<OpKind, 'collection' | 'member', any, any, ScopeOf<TConfig>, ModeOf<TConfig>>
  >,
  const TId extends string = never,
>(
  config: TConfig,
  def: {
    name: string
    description: string
    id?: TId
    ops: TOps
    modes?: readonly ModeOf<TConfig>[]
    restrict?: Partial<Record<FieldsOf<TOps>, readonly ModeOf<TConfig>[]>>
  },
): ServiceDef<WithProcesses<TOps>, TId, undefined> {
  void config
  for (const [name, op] of Object.entries(def.ops)) {
    if (op.on === 'member' && !def.id) {
      throw new Error(`onedef: ${def.name}.${name} is a member op, but service "${def.name}" declares no \`id\``)
    }
  }
  return { ...def, ops: withProcesses(def.name, def.ops) } as unknown as ServiceDef<WithProcesses<TOps>, TId, undefined>
}

/**
 * The contract every surface consumes. Services are passed directly and their
 * types are preserved — erasing them here would erase every client type
 * derived downstream.
 */
export function defineApi<const TConfig extends ApiConfig, const TServices extends Record<string, AnyService>>(
  config: TConfig,
  services: TServices,
): Api<TServices, TConfig> {
  for (const [key, svc] of Object.entries(services)) {
    for (const [name, op] of Object.entries(svc.ops)) {
      for (const scope of op.scope ?? []) {
        if (!config.scopes?.[scope]) throw new Error(`onedef: ${key}.${name} declares unknown scope "${scope}"`)
      }
    }
  }
  return { config, services }
}

/** Every op of an api as `'<service>.<op>'`, e.g. `'songs.get'` — how options name ops. */
export type OpRef<TApi extends Api> = {
  [S in keyof TApi['services'] & string]: `${S}.${keyof TApi['services'][S]['ops'] & string}`
}[keyof TApi['services'] & string]

/** Walk every op of an api in declaration order. */
export function eachOp(api: Api): { key: string; svc: AnyService; name: string; op: AnyOp }[] {
  return Object.entries(api.services).flatMap(([key, svc]) =>
    Object.entries(svc.ops).map(([name, op]) => ({ key, svc, name, op })),
  )
}

/** Look up one op; throws a helpful error for a name the contract does not have. */
export function opOf(api: Api, service: string, op: string): { svc: AnyService; op: AnyOp } {
  const svc = api.services[service]
  const def = svc?.ops[op]
  if (!svc || !def) throw new ApiError('NOT_FOUND', `The contract has no op "${service}.${op}"`)
  return { svc, op: def }
}
