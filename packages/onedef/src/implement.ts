import { credentialsFromHeaders, type Credentials } from './auth.js'
import { createClient, type ApiClient, type Call, type Transport } from './client.js'
import {
  opOf,
  type AnyOp,
  type Api,
  type ApiConfig,
  type Out,
  type Result,
  type Schema,
  type ServiceMap,
} from './contract.js'
import { ApiError } from './errors.js'
import { redact } from './access.js'
import { callDescriptor, type HttpOptions } from './http.js'
import { scopeHeaders, type ScopeValues } from './scope.js'
import { parseInput, validateOutput } from './validate.js'
import type { HasProcess, ProcessRun, ProcessState, ProcessTools, RunStore } from './process.js'

/** What `context()` receives: the inbound request (absent in-process) and parsed credentials. */
export interface ContextArgs {
  request?: Request
  auth?: Credentials
}

/** What every handler receives. */
export interface HandlerArgs<TApi extends Api, TCtx, TInput, TOn, TObject = undefined> {
  /** The validated input, without the member id. */
  input: TInput
  /** The current object, loaded through `get` — present when the op declares `needs: 'object'`. */
  object: TObject
  /** The member id — present exactly when the op is a member op. */
  id: TOn extends 'member' ? string : undefined
  /** Whatever `context()` returned for this request. */
  ctx: TCtx
  /** Tenancy values for this call (already checked against `required`). */
  scope: ScopeValues
  /** A typed client bound to this same request: call another op without HTTP. */
  client: ApiClient<TApi>
  request?: Request
}

type OpField<TOp, TKey extends string> =
  TOp extends Partial<Record<TKey, infer TValue>>
    ? [NonNullable<TValue>] extends [never]
      ? undefined
      : NonNullable<TValue>
    : undefined

// A plain function type on purpose: a conditional type at this level stops
// TypeScript from flowing `context()`'s return type into the handlers' `ctx`.
/** The object a `needs: 'object'` op receives: the resource's fields, or what its `get` returns. */
type ObjectOf<TService> = TService extends { resource?: { fields: infer TFields } }
  ? [TFields] extends [Schema]
    ? Out<TFields>
    : GetResult<TService>
  : GetResult<TService>
type GetResult<TService> = TService extends { ops: { get: { output?: infer TOutput } } }
  ? Out<NonNullable<TOutput>>
  : unknown

// A process handler gets the regular arguments plus `step`, `elicitAgentInput`, `headless` and `runId`.
type HandlerFor<TApi extends Api, TCtx, TOp, TService> = (
  args: HandlerArgs<
    TApi,
    TCtx,
    Out<OpField<TOp, 'input'>>,
    OpField<TOp, 'on'>,
    TOp extends { needs: 'object' } ? ObjectOf<TService> : undefined
  > &
    (TOp extends { process: true } ? ProcessTools : {}),
) => Result<OpField<TOp, 'output'>> | Promise<Result<OpField<TOp, 'output'>>>

type OpsOf<TService> = TService extends { ops: infer TOps } ? TOps : never

/**
 * Ops without an `http` descriptor must be implemented; ops with one may be
 * (otherwise they proxy). A process's derived `<op>Start` / `<op>Next` are
 * answered by its own handler, so they take none.
 */
export type ServiceHandlers<TApi extends Api, TCtx, TService> = {
  [K in keyof OpsOf<TService> as OpsOf<TService>[K] extends { http: object } | { processOf: object }
    ? never
    : K]: HandlerFor<
    TApi,
    TCtx,
    OpsOf<TService>[K],
    TService
  >
} & {
  [K in keyof OpsOf<TService> as OpsOf<TService>[K] extends { http: object } ? K : never]?: HandlerFor<
    TApi,
    TCtx,
    OpsOf<TService>[K],
    TService
  >
}

/** Every service's handlers. A mapped type, not a conditional one, so `ctx` infers from `context()`. */
export type Handlers<TServices extends ServiceMap, TConfig extends ApiConfig, TCtx> = {
  [K in keyof TServices]: ServiceHandlers<Api<TServices, TConfig>, TCtx, TServices[K]>
}

type AnyHandler = (args: HandlerArgs<Api, unknown, unknown, unknown, unknown>) => unknown

const CTX = Symbol('onedef.ctx')

/** @internal lets `forMode` re-bind a backend to a projected contract. */
export const REBIND = Symbol.for('onedef.rebind')

/** A contract with its handlers attached. Server-only by construction. */
export interface Backend<TApi extends Api = Api> {
  readonly api: TApi
  /** @internal */
  readonly [REBIND]?: (api: Api) => Backend<any>
  /** Answer one call — what every host and the `local()` transport delegate to. */
  handle(call: Call): Promise<unknown>
}

export interface ImplementOptions {
  /** Where ops with an `http` descriptor but no handler are proxied to. Credentials default to the caller's own. */
  upstream?: HttpOptions
  /**
   * Where process runs live (`runsIn(store)` or `memoryRunStore()` from
   * `@onedef/process`). Required exactly when the contract has a process.
   */
  runStore?: RunStore
}

/** `implement()`'s options: `runStore` is required when the contract has a process, optional otherwise. */
export type OptionsFor<TServices> =
  HasProcess<TServices> extends true
    ? [options: ImplementOptions & { runStore: RunStore }]
    : [options?: ImplementOptions]

/**
 * Attach handlers to a contract. The result is the backend — host it with
 * `toFetchHandler(backend)` (REST + RPC + OpenAPI), call it in process with
 * `local(backend)`, or serve it over MCP with `createMcpHandler(backend)`.
 *
 *   export const backend = implement(contract, {
 *     context: async ({ request }) => ({ userId: await verify(request) }),
 *     songs: {
 *       list: async () => storage.list(),
 *       get: async ({ id }) => (await storage.get(id)) ?? fail('NOT_FOUND', `No lesson "${id}"`),
 *     },
 *   })
 *
 * Every op is checked at compile time: a missing handler, a misspelt op or a
 * wrong return shape is a type error. Input is validated before a handler
 * runs, so handlers only ever see parsed values.
 */
export function implement<TServices extends ServiceMap, TConfig extends ApiConfig, TCtx = undefined>(
  api: Api<TServices, TConfig>,
  impl: { context?: (args: ContextArgs) => TCtx | Promise<TCtx> } & Handlers<TServices, TConfig, Awaited<TCtx>>,
  ...[options = {}]: OptionsFor<TServices>
): Backend<Api<TServices, TConfig>> {
  const { runStore } = options as ImplementOptions
  const handlers = impl as unknown as Record<string, Record<string, AnyHandler | undefined>> & {
    context?: (args: ContextArgs) => unknown
  }
  for (const [key, svc] of Object.entries(api.services as Record<string, { ops: Record<string, AnyOp> }>)) {
    for (const [name, op] of Object.entries(svc.ops) as [string, AnyOp][]) {
      if (op.process && !runStore) {
        throw new Error(`onedef: ${key}.${name} is a process; pass implement(contract, handlers, { runStore })`)
      }
      if (op.needs === 'object' && !svc.ops.get) {
        throw new Error(`onedef: ${key}.${name} needs the object, but service "${key}" has no \`get\` op to load it`)
      }
      if (op.processOf) continue // answered by the process's own handler
      if (!op.http && typeof handlers[key]?.[name] !== 'function') {
        throw new Error(
          `onedef: implement() is missing a handler for ${key}.${name} (and it has no \`http\` descriptor to proxy)`,
        )
      }
    }
  }

  const bind = (current: Api): Backend<any> => {
    const backend: Backend<any> = {
      api: current,
      [REBIND]: bind,
      async handle(call: Call) {
        const { svc, op } = opOf(current, call.service, call.op)
        const where = `${call.service}.${call.op}`
        const raw = (call.input ?? {}) as Record<string, unknown>

        // checked first: a missing required scope must never reach a handler
        scopeHeaders(current, op, call.scope, where)

        const { id, input } = await parseInput(svc, op, raw, where)

        // `<op>Start` / `<op>Next` run the process `<op>`'s handler
        const target = op.processOf?.op ?? call.op
        const targetOp = op.processOf ? svc.ops[target]! : op
        const handler = handlers[call.service]?.[target]
        const auth =
          call.auth ?? (call.request ? credentialsFromHeaders(current.config.auth, call.request.headers) : undefined)
        if (!handler) {
          const proxied = await callDescriptor(current, call, {
            ...options.upstream,
            ...(auth ? { credentials: auth } : {}),
          })
          return redact(current, svc, await validateOutput(op, proxied, where))
        }

        // computed once per inbound call: nested `client` calls reuse it rather
        // than re-verifying the caller's token for every hop
        const inherited = (call as Call & { [CTX]?: { value: unknown } })[CTX]
        const ctx = inherited
          ? inherited.value
          : await handlers.context?.({ ...(call.request ? { request: call.request } : {}), ...(auth ? { auth } : {}) })
        // A handler's own calls run against the full contract: `forMode` limits
        // what callers see, not what the server may read to answer them.
        const bound: Transport = (inner) =>
          (root ?? backend).handle({
            ...inner,
            [CTX]: { value: ctx },
            scope: { ...call.scope, ...inner.scope },
            ...(call.request ? { request: call.request } : {}),
            ...(auth ? { auth } : {}),
          } as Call)
        const object =
          op.needs === 'object'
            ? await bound({ service: call.service, op: 'get', input: svc.id ? { [svc.id]: id } : {} }, api)
            : undefined
        const common = {
          ctx,
          scope: call.scope ?? {},
          client: createClient(api, bound) as ApiClient<Api>,
          ...(call.request ? { request: call.request } : {}),
        }
        if (!targetOp.process) {
          const result = await handler({ ...common, input, object, id: id as undefined })
          return redact(current, svc, await validateOutput(op, result, where))
        }

        // A process. What it was started with is recorded in the run, so a
        // later `next` (which carries only the run id) replays with the same input.
        const process: ProcessRun = {
          name: `${call.service}.${target}`,
          fn: (tools, recorded) =>
            Promise.resolve(handler({ ...common, ...(recorded as object), ...tools } as never)),
        }
        const recorded = { input, ...(id !== undefined ? { id } : {}), ...(object !== undefined ? { object } : {}) }
        if (!op.processOf) {
          const result = await runStore!.run(process, recorded)
          return redact(current, svc, await validateOutput(op, result, where))
        }
        const state: ProcessState =
          op.processOf.step === 'start'
            ? await runStore!.start(process, recorded)
            : await runStore!.next(process, (input as { runId: string }).runId, (input as { payload?: unknown }).payload)
        if (state.status === 'done') {
          state.output = redact(current, svc, await validateOutput(targetOp, state.output, `${call.service}.${target}`))
        }
        return state
      },
    }
    return backend
  }
  let root: Backend<any> | undefined
  root = bind(api)
  return root as Backend<Api<TServices, TConfig>>
}

/**
 * Call a backend in process — no HTTP, no serialisation. For server
 * components, server actions, jobs, tests, and MCP servers that ship the
 * handlers. Pass `request` so `context()` sees the caller.
 */
export function local(backend: Backend<any>, options: { request?: () => Request | undefined } = {}): Transport {
  return (call) => {
    const request = call.request ?? options.request?.()
    return backend.handle(request ? { ...call, request } : call)
  }
}

/** True for a backend (`implement()` result), false for a bare contract. */
export const isBackend = (value: unknown): value is Backend<any> =>
  typeof value === 'object' && value !== null && typeof (value as Backend).handle === 'function' && 'api' in value
