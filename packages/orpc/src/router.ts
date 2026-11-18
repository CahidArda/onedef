import { oo } from '@orpc/openapi'
import { ORPCError, os, type Procedure } from '@orpc/server'
import {
  isApiError,
  routeOf,
  scopeFromHeaders,
  scopesOf,
  toJsonSchema,
  withPathKeys,
  type AnyOp,
  type AnyService,
  type Api,
  type Backend,
  type Schema,
} from 'onedef'

/**
 * What every procedure needs from its host: the inbound request. Credentials,
 * scope headers and `context()` are all derived from it by the backend, so a
 * host never has to parse anything itself. `toFetchHandler` supplies it; with
 * oRPC's fetch handlers directly, pass `{ context: { request } }`.
 */
export interface RequestContext {
  request: Request
}

export type AnyProcedure = Procedure<any, any, any, any, any, any>
/** `router[serviceKey][opName]` — the shape oRPC's handlers and generators accept. */
export type OnedefRouter = Record<string, Record<string, AnyProcedure>>

const base = os.$context<RequestContext>()

/**
 * A schema oRPC can describe but never validates. The backend already
 * validates every call (it is the one choke point shared with `local()` and
 * MCP), so letting oRPC validate first would run transforms twice and turn
 * input errors into oRPC's `BAD_REQUEST` instead of onedef's `INVALID_INPUT`.
 */
const describeOnly = (schema: Schema): Schema =>
  ({
    '~standard': {
      version: 1,
      vendor: 'onedef',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => toJsonSchema(schema, 'input'), output: () => toJsonSchema(schema, 'output') },
    },
  }) as Schema

/** `http.errors` (`{ 404: 'NOT_FOUND' }`) as OpenAPI responses. */
const errorResponses = (op: AnyOp) =>
  Object.fromEntries(
    Object.entries(op.http?.errors ?? {}).map(([status, code]) => [
      status,
      {
        description: code,
        content: {
          'application/json': {
            schema: {
              type: 'object' as const,
              properties: { code: { type: 'string' as const, const: code }, message: { type: 'string' as const } },
              required: ['code'],
            },
          },
        },
      },
    ]),
  )

/**
 * OpenAPI facts no input/output schema can express — scope headers (they
 * travel as headers, never in the input), declared error responses and the
 * destructive marker — ride the procedure as an `oo.spec` middleware, so the
 * router stays the single artifact the OpenAPI document is generated from.
 */
const specOf = (api: Api, op: AnyOp) =>
  oo.spec(
    base.middleware(({ next }) => next()),
    (current) => ({
      ...current,
      parameters: [
        ...(current.parameters ?? []),
        ...scopesOf(api, op).map((scope) => ({
          name: scope.header,
          in: 'header' as const,
          required: scope.required ?? false,
          description: scope.description,
          schema: { type: 'string' as const },
        })),
      ],
      responses: { ...current.responses, ...errorResponses(op) },
      ...(op.destructive ? { 'x-destructive': true } : {}),
    }),
  )

/** Keep an `ApiError`'s code and status on the wire; anything else becomes oRPC's opaque 500. */
const toORPCError = (error: unknown) =>
  isApiError(error)
    ? new ORPCError(error.code, {
        status: error.status >= 400 && error.status < 600 ? error.status : 500,
        message: error.message,
        data: error.data,
        cause: error,
      })
    : error

/**
 * The backend as an oRPC router: `router[serviceKey][opName]`, each procedure
 * carrying its REST route (`GET /songs/{slug}`, from core's `routeOf`, so the
 * docs nav and the CLI agree with it) and full OpenAPI metadata. Every call is
 * answered by `backend.handle`, which validates input, checks scopes and runs
 * `context()` — this router adds transport, never behaviour.
 *
 * `toFetchHandler` is the usual way in; use this directly to mount the backend
 * with oRPC's handlers and plugins of your own choosing.
 */
export function toRouter(backend: Backend<any>, options: { prefix?: string } = {}): OnedefRouter {
  const api: Api = backend.api
  const router: OnedefRouter = {}
  for (const [key, svc] of Object.entries(api.services) as [string, AnyService][]) {
    router[key] = {}
    for (const [name, op] of Object.entries(svc.ops)) {
      const route = routeOf(svc, name, op, options.prefix)
      // member ops are addressed by a path parameter, so the id must be part of the input
      const input = op.on === 'member' ? withPathKeys(op.input, [svc.id!]) : op.input
      let procedure = base.use(specOf(api, op)).route({
        method: route.method,
        path: route.path as `/${string}`,
        summary: op.summary,
        ...(op.description ? { description: op.description } : {}),
        operationId: route.operationId,
        tags: [svc.name],
      })
      if (input) procedure = procedure.input(describeOnly(input)) as unknown as typeof procedure
      // the backend validates output too, so every transport returns the same shape
      if (op.output) procedure = procedure.output(describeOnly(op.output)) as unknown as typeof procedure
      router[key][name] = procedure.handler(async ({ input, context }) => {
        try {
          return await backend.handle({
            service: key,
            op: name,
            input: (input ?? {}) as Record<string, unknown>,
            scope: scopeFromHeaders(api, context.request.headers),
            request: context.request,
          })
        } catch (error) {
          throw toORPCError(error)
        }
      })
    }
  }
  return router
}
