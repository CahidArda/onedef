import { credentialHeaders, type Credentials } from './auth.js'
import type { Call, Transport } from './client.js'
import { opOf, type AnyOp, type AnyService, type Api, type HttpDescriptor } from './contract.js'
import { ApiError, codeOf } from './errors.js'
import { redact } from './access.js'
import { scopeHeaders } from './scope.js'
import { parseInput, validateOutput } from './validate.js'

export type Resolvable<TValue> = TValue | (() => TValue | Promise<TValue>)
export const resolve = async <TValue>(value: Resolvable<TValue>): Promise<TValue> =>
  typeof value === 'function' ? (value as () => TValue | Promise<TValue>)() : value

export interface HttpOptions {
  /** Base URL of the REST API the descriptors point at. Defaults to `config.baseUrl`. */
  baseUrl?: string
  /** Credentials for every call, read per call. A call's own `auth` wins. */
  auth?: Resolvable<Credentials | undefined>
  /** Extra headers per call. */
  headers?: Resolvable<Record<string, string | undefined>>
  fetch?: typeof globalThis.fetch
}

const PARAM = /\{(\w+)\}/g

/** A path parameter's value, read from the input; `{id}` means the service's member id. */
const paramOf = (svc: AnyService, input: Record<string, unknown>, name: string) =>
  name === 'id' && svc.id ? input[svc.id] : input[name]

/**
 * What a forwarded request carries: its own Authorization (and declared
 * api-key header), so a server surface acting for a caller acts AS that caller.
 */
export function forwardedHeaders(api: Api, request: Request | undefined): Record<string, string> {
  if (!request) return {}
  const headers: Record<string, string> = {}
  for (const name of new Set(['authorization', api.config.auth?.apiKey?.header?.toLowerCase() ?? 'authorization'])) {
    const value = request.headers.get(name)
    if (value) headers[name] = value
  }
  return headers
}

/**
 * Execute one op's HTTP descriptor. This is the whole of "mode 2": the
 * backend exists somewhere already, and the contract only says where.
 */
export async function callDescriptor(
  api: Api,
  call: Call,
  options: HttpOptions & { descriptor?: HttpDescriptor; credentials?: Credentials } = {},
): Promise<unknown> {
  const { svc, op } = opOf(api, call.service, call.op)
  const descriptor = options.descriptor ?? op.http
  if (!descriptor) {
    throw new ApiError(
      'NOT_IMPLEMENTED',
      `${call.service}.${call.op} has no \`http\` descriptor, so it cannot be called over http()`,
    )
  }
  const baseUrl = options.baseUrl ?? api.config.baseUrl
  if (!baseUrl) throw new Error(`onedef: http() needs a baseUrl (or set \`baseUrl\` in defineConfig)`)

  const input = call.input ?? {}
  const used = new Set<string>()
  const path = descriptor.path.replace(PARAM, (_, name: string) => {
    used.add(name === 'id' && svc.id ? svc.id : name)
    return encodeURIComponent(String(paramOf(svc, input, name) ?? ''))
  })
  const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  for (const [name, value] of Object.entries(descriptor.query?.({ input }) ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value))
  }

  const hasBody = descriptor.method !== 'GET' && descriptor.method !== 'DELETE'
  const credentials = call.auth ?? options.credentials ?? (await resolve(options.auth))
  const headers: Record<string, string> = {
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(credentials ? credentialHeaders(api.config.auth, credentials) : forwardedHeaders(api, call.request)),
    ...Object.fromEntries(
      Object.entries((await resolve(options.headers)) ?? {}).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    ...(descriptor.headers?.({ input }) ?? {}),
    ...scopeHeaders(api, op, call.scope, `${call.service}.${call.op}`),
  }
  const body = hasBody
    ? JSON.stringify(
        descriptor.body?.({ input }) ?? Object.fromEntries(Object.entries(input).filter(([key]) => !used.has(key))),
      )
    : undefined

  const res = await (options.fetch ?? globalThis.fetch)(url, {
    method: descriptor.method,
    headers,
    ...(body !== undefined ? { body } : {}),
    ...(call.signal ? { signal: call.signal } : {}),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const code = descriptor.errors?.[res.status] ?? (res.status >= 500 ? 'UPSTREAM_ERROR' : codeOf(res.status))
    throw new ApiError(
      code,
      `${descriptor.method} ${url.pathname} → ${res.status}${text ? `: ${text.slice(0, 300)}` : ''}`,
      {
        status: res.status,
      },
    )
  }
  const raw = res.status === 204 ? undefined : await res.json().catch(() => undefined)
  return redact(api, svc, descriptor.select ? descriptor.select(raw) : raw)
}

/**
 * Call an existing REST API through the contract's `http` descriptors —
 * "mode 2", where no onedef backend exists at all.
 */
export function http(options: HttpOptions = {}): Transport {
  return async (call, api) => {
    // validated here (and not in callDescriptor, which a backend also uses after
    // validating) so a bad input never reaches the upstream
    const { svc, op } = opOf(api, call.service, call.op)
    const { id, input } = await parseInput(svc, op, call.input ?? {}, `${call.service}.${call.op}`)
    const parsed = { ...(input as object), ...(id !== undefined ? { [svc.id!]: id } : {}) }
    return validateOutput(
      op,
      await callDescriptor(api, { ...call, input: parsed }, options),
      `${call.service}.${call.op}`,
    )
  }
}

/** Ops of an api that can run over `http()` — i.e. carry a descriptor. */
export const hasDescriptor = (op: AnyOp): boolean => Boolean(op.http)
