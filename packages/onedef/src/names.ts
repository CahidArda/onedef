import type { AnyOp, AnyService, Api, HttpMethod } from './contract.js'

/**
 * Every derived name lives here, once. The MCP App client computes the tool
 * name it calls with the same function the MCP server registered it under,
 * and the REST client builds the same path the router serves — so these can
 * never drift between two packages.
 */

const words = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())

/** `setOffset` → `set-offset`. */
export const kebab = (value: string) => words(value).join('-')
/** `setOffset` → `set_offset`. */
export const snake = (value: string) => words(value).join('_')

/** `songs.setOffset` → `songs_set_offset` (prefixed by `config.toolPrefix`). */
export function toolName(api: Api, service: string, op: string): string {
  const def = api.services[service]?.ops[op]
  if (!def) throw new Error(`onedef: the contract has no op "${service}.${op}"`)
  if (def.mcp?.name) return def.mcp.name
  const prefix = api.config.toolPrefix ? `${snake(api.config.toolPrefix)}_` : ''
  return `${prefix}${snake(api.services[service]?.name ?? service)}_${snake(op)}`
}

/** CLI words for an op: `['songs', 'set-offset']`. */
export function commandPath(svc: AnyService, op: string, def: AnyOp): string[] {
  return [kebab(svc.name), def.cli?.command ?? kebab(op)]
}

export interface Route {
  method: HttpMethod
  /** OpenAPI-style path, e.g. `/songs/{slug}/set-offset`. */
  path: string
  operationId: string
}

/**
 * The REST shape of an op — shared by the router, the OpenAPI document and
 * the docs nav, so a nav entry like `GET /songs/{slug}` cannot drift from the
 * route that serves it.
 *
 *   list   (collection query) GET  /songs
 *   get    (member query)     GET  /songs/{slug}
 *   search (collection query) GET  /songs/search
 *   create (collection mut.)  POST /songs
 *   delete (member mutation)  DELETE /songs/{slug}
 */
export function routeOf(svc: AnyService, op: string, def: AnyOp, prefix = ''): Route {
  const base = `${prefix}/${kebab(svc.name)}`
  const member = def.on === 'member' ? `/{${svc.id}}` : ''
  // REST conventions where the name says it all; every other op gets its own segment
  const conventional =
    def.kind === 'query'
      ? (op === 'list' && def.on === 'collection') || (op === 'get' && (def.on === 'member' || !svc.ops.list)) // a singleton's get is the resource itself
      : (op === 'create' && def.on === 'collection') || (op === 'delete' && def.on === 'member')
  const path = def.route?.path
    ? `${prefix}${def.route.path}`
    : conventional
      ? `${base}${member}`
      : `${base}${member}/${kebab(op)}`
  const method =
    def.route?.method ?? (def.kind === 'query' ? 'GET' : conventional && op === 'delete' ? 'DELETE' : 'POST')
  return {
    method,
    path,
    operationId: `${svc.name}.${op}`,
  }
}

/** `GET /songs/{slug}` — the exact string Mintlify's navigation expects. */
export const navEntry = (route: Route): string => `${route.method} ${route.path}`
