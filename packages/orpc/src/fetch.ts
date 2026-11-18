import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { RPCHandler } from '@orpc/server/fetch'
import type { Backend } from 'onedef'
import { generateOpenApi, type OpenApiOptions } from './openapi.js'
import { toRouter } from './router.js'

export interface FetchHandlerOptions {
  /** Where the API is mounted. Default `/api` — Next.js's `app/api/[[...route]]/route.ts`. */
  prefix?: string
  /** Document info for `{prefix}/openapi.json`; defaults come from the config. */
  openapi?: Omit<OpenApiOptions, 'prefix'>
  /** Answer CORS preflights and allow this origin (`true` = any origin). Off by default. */
  cors?: boolean | string
}

/**
 * Serve a backend over HTTP, as one `(request) => Response` function:
 *
 *   {prefix}/rpc/*          oRPC RPC — what the `rpc({ url })` transport calls
 *   {prefix}/openapi.json   the OpenAPI document, generated once on first request
 *   {prefix}/...            REST, e.g. `GET /api/songs/{slug}`
 *
 * A fetch handler rather than a server, so it drops into anything that speaks
 * `Request`/`Response`: Next.js, Hono, Bun, Deno, workers. For Next.js, see
 * `toNextHandlers`.
 */
export function toFetchHandler(
  backend: Backend<any>,
  options: FetchHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const prefix = (options.prefix ?? '/api').replace(/\/+$/, '')
  const router = toRouter(backend, { prefix })
  const rpc = new RPCHandler(router)
  const rest = new OpenAPIHandler(router)
  let spec: Promise<unknown> | undefined

  const handle = async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url)
    const context = { request }
    if (pathname === `${prefix}/openapi.json` && request.method === 'GET') {
      spec ??= generateOpenApi(backend.api, { ...options.openapi, prefix }).catch((error) => {
        spec = undefined // retry next time rather than caching a failure
        throw error
      })
      return Response.json(await spec)
    }
    const result = pathname.startsWith(`${prefix}/rpc/`)
      ? await rpc.handle(request, { prefix: `${prefix}/rpc` as `/${string}`, context })
      : await rest.handle(request, { context })
    if (result.matched) return result.response
    return Response.json({ code: 'NOT_FOUND', message: `No route for ${request.method} ${pathname}` }, { status: 404 })
  }

  if (!options.cors) return handle
  const origin = options.cors === true ? '*' : options.cors
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
          'access-control-allow-headers': request.headers.get('access-control-request-headers') ?? '*',
          'access-control-max-age': '86400',
        },
      })
    }
    const response = await handle(request)
    // copied because a Response's headers may be immutable
    const copy = new Response(response.body, response)
    copy.headers.set('access-control-allow-origin', origin)
    return copy
  }
}

/**
 * The fetch handler under every method name a Next.js App Router route
 * exports. In `app/api/[[...route]]/route.ts`:
 *
 *   export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = toNextHandlers(backend)
 */
export function toNextHandlers(backend: Backend<any>, options: FetchHandlerOptions = {}) {
  const handler = toFetchHandler(backend, options)
  return { GET: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler, OPTIONS: handler }
}
