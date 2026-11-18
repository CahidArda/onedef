import type { AnyOp, AnyService, Api, In, Result } from './contract.js'
import type { Credentials } from './auth.js'
import type { ScopeValues } from './scope.js'

/**
 * One call, as every transport sees it. The client facade produces these; a
 * transport answers them — over HTTP, in process, or as an MCP tool call.
 */
export interface Call {
  service: string
  op: string
  /** The op's input, including the member id field for member ops. */
  input: Record<string, unknown>
  scope?: ScopeValues
  signal?: AbortSignal
  /**
   * The inbound request this call is being made on behalf of, when a server
   * surface (MCP over HTTP, a proxy) forwards it. Lets `local()` derive the
   * handler context and lets `rpc()`/`http()` forward the caller's credentials.
   */
  request?: Request
  /** Explicit credentials for this call, overriding the transport's own. */
  auth?: Credentials
}

/**
 * The "requester": answers a call. Swapping it is the only difference
 * between a web client, a server-side client, a CLI, an MCP server that
 * forwards, and a UI running inside an MCP App.
 */
export type Transport = (call: Call, api: Api) => Promise<unknown>

/** Per-call options. Tenancy travels here, never in the input. */
export interface CallOptions<TScope extends string = string> {
  scope?: Partial<Record<TScope, string>>
  signal?: AbortSignal
}

type IdInput<TService, TOp> = TOp extends { on: 'member' }
  ? TService extends { id?: infer TId extends string }
    ? { [K in TId]: string }
    : {}
  : {}

/** What a caller passes to one op: the member id (if any) plus the op's input. */
export type OpInput<TService, TOp> = IdInput<TService, TOp> & (TOp extends { input?: infer TSchema } ? In<TSchema> : {})
/** What one op resolves to. */
export type OpResult<TOp> = TOp extends { output?: infer TSchema } ? Result<TSchema> : unknown

type ScopeNames<TApi> = TApi extends Api<any, infer TConfig> ? keyof TConfig['scopes'] & string : string

type OpFn<TService, TOp, TScope extends string> =
  {} extends OpInput<TService, TOp>
    ? (input?: OpInput<TService, TOp>, options?: CallOptions<TScope>) => Promise<OpResult<TOp>>
    : (input: OpInput<TService, TOp>, options?: CallOptions<TScope>) => Promise<OpResult<TOp>>

export type ServiceClient<TService, TScope extends string = string> = TService extends { ops: infer TOps }
  ? { [K in keyof TOps]: OpFn<TService, TOps[K], TScope> }
  : never

/** The typed client for a whole contract: `client.songs.get({ slug })`. */
export type ApiClient<TApi> =
  TApi extends Api<infer TServices, any>
    ? { [K in keyof TServices]: ServiceClient<TServices[K], ScopeNames<TApi>> }
    : never

/** Input and result types of one op, for naming them in app code. */
export type InputOf<TApi, TService extends string, TOp extends string> =
  TApi extends Api<infer TServices, any> ? OpInput<TServices[TService], TServices[TService]['ops'][TOp]> : never
export type OutputOf<TApi, TService extends string, TOp extends string> =
  TApi extends Api<infer TServices, any> ? OpResult<TServices[TService]['ops'][TOp]> : never

export interface ClientOptions {
  /** Default scope values; a call's own `{ scope }` wins. Read per call. */
  scope?: () => ScopeValues | undefined
}

/**
 * A typed client for the contract over any transport:
 *
 *   createClient(contract, rpc({ url: '/api' }))          // a deployed onedef backend
 *   createClient(contract, http({ baseUrl }))             // an existing REST API
 *   createClient(contract, local(backend))                // in process, no HTTP
 *   createClient(contract, mcpApp() ?? rpc({ url }))      // the same UI on the web and in an MCP App
 *
 * Unknown service/op names fail loudly at call time rather than sending a
 * request the server cannot route.
 */
export function createClient<TApi extends Api<any, any>>(
  api: TApi,
  transport: Transport,
  options: ClientOptions = {},
): ApiClient<TApi> {
  return new Proxy({} as Record<string, unknown>, {
    get: (_root, service) => {
      if (typeof service !== 'string') return undefined
      const svc = (api.services as Record<string, AnyService>)[service]
      if (!svc) return undefined
      return new Proxy({} as Record<string, unknown>, {
        get: (_svc, op) => {
          if (typeof op !== 'string') return undefined
          const def: AnyOp | undefined = svc.ops[op]
          if (!def) return undefined
          return (input: Record<string, unknown> = {}, callOptions: CallOptions = {}) =>
            transport(
              {
                service,
                op,
                input,
                scope: { ...options.scope?.(), ...callOptions.scope },
                ...(callOptions.signal ? { signal: callOptions.signal } : {}),
              },
              api,
            )
        },
      })
    },
  }) as ApiClient<TApi>
}
