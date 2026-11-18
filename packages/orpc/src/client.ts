import { createORPCClient, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import {
  ApiError,
  credentialHeaders,
  forwardedHeaders,
  opOf,
  resolve,
  scopeHeaders,
  type Credentials,
  type Resolvable,
  type Transport,
} from 'onedef'

export interface RpcOptions {
  /** Where the backend is mounted, e.g. `/api` or `https://x.app/api` — the `prefix` of `toFetchHandler`. */
  url: string
  /** Credentials for every call, read per call (so a rotated token is picked up). A call's own `auth` wins. */
  auth?: Resolvable<Credentials | undefined>
  /** Extra headers per call. */
  headers?: Resolvable<Record<string, string | undefined>>
  fetch?: typeof globalThis.fetch
}

/**
 * Call a `toFetchHandler` backend over oRPC's RPC protocol:
 *
 *   const client = createClient(contract, rpc({ url: '/api', auth: async () => ({ bearer: await getToken() }) }))
 *
 * Credentials and scope travel as headers, exactly as `http()` sends them, and
 * a required scope with no value fails here, before anything is sent. Errors
 * come back as the same `ApiError` (code, status, data) the handler threw.
 *
 * With no credentials of its own, a call made on behalf of a request
 * (`call.request`) forwards that request's credentials — so a server surface
 * calling the backend for a user acts as that user.
 */
export function rpc(options: RpcOptions): Transport {
  let client: any
  // lazy: a relative url can only be resolved once there is a `location`, and building
  // the link at module load would break server-side imports of a shared client module
  const orpc = () => {
    if (client) return client
    const origin = globalThis.location?.origin
    if (!origin && !/^[a-z][a-z0-9+.-]*:/i.test(options.url)) {
      throw new Error(
        `onedef: rpc({ url: '${options.url}' }) is relative, which only works in a browser; pass an absolute url`,
      )
    }
    const link = new RPCLink<{ headers?: Record<string, string> }>({
      url: new URL(`${options.url.replace(/\/+$/, '')}/rpc`, origin).href,
      headers: ({ context }) => context.headers ?? {},
      ...(options.fetch ? { fetch: (request: Request, init: RequestInit) => options.fetch!(request, init) } : {}),
    })
    return (client = createORPCClient(link))
  }

  return async (call, api) => {
    const { op } = opOf(api, call.service, call.op)
    const credentials = call.auth ?? (await resolve(options.auth))
    const headers: Record<string, string> = {
      ...(credentials ? credentialHeaders(api.config.auth, credentials) : forwardedHeaders(api, call.request)),
      ...Object.fromEntries(
        Object.entries((await resolve(options.headers)) ?? {}).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      ...scopeHeaders(api, op, call.scope, `${call.service}.${call.op}`),
    }
    try {
      return await orpc()[call.service][call.op](call.input, {
        context: { headers },
        ...(call.signal ? { signal: call.signal } : {}),
      })
    } catch (error) {
      if (error instanceof ORPCError) {
        throw new ApiError(error.code, error.message, { status: error.status, data: error.data, cause: error })
      }
      throw error
    }
  }
}
