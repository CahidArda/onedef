import type { AnyOp, AnyService, Api } from './contract.js'
import { omitFrom, stripKeys } from './jsonschema.js'

const REBIND = Symbol.for('onedef.rebind')

const allows = (rule: readonly string[] | undefined, mode: string) => !rule || rule.includes(mode)

/** Fields of a service hidden from `mode`. */
export function hiddenFields(svc: AnyService, mode: string): string[] {
  return Object.entries(svc.restrict ?? {})
    .filter(([, modes]) => !allows(modes, mode))
    .map(([field]) => field)
}

const HIDDEN = Symbol.for('onedef.hidden')
type Projected = AnyService & { [HIDDEN]?: string[] }

/** Strip whatever `forMode` hid on this service from a runtime value. */
export function redact(_api: Api, svc: AnyService, value: unknown): unknown {
  const hidden = (svc as Projected)[HIDDEN]
  return hidden?.length ? stripKeys(value, hidden) : value
}

/**
 * Project a contract down to what one credential mode may touch:
 *
 *   createMcpHandler(forMode(backend, 'oauth'), ...)   // OAuth callers never see rest_token
 *
 * Enforced in three places on purpose: the schemas (so docs, OpenAPI and MCP
 * tool definitions never mention a hidden field), runtime values (so a
 * passthrough handler or upstream cannot leak it), and the op list (a gated
 * op is absent, not merely undocumented). Works on a contract or a backend.
 */
export function forMode<TTarget extends Api | { api: Api }>(target: TTarget, mode: string): TTarget {
  if ('api' in target && !('services' in target)) {
    const projected = forMode(target.api, mode)
    const rebind = (target as { [REBIND]?: (api: Api) => unknown })[REBIND]
    return (rebind ? rebind(projected) : { ...target, api: projected }) as TTarget
  }
  const api = target as Api
  const services: Record<string, AnyService> = {}
  for (const [key, svc] of Object.entries(api.services)) {
    if (!allows(svc.modes, mode)) continue
    const hidden = hiddenFields(svc, mode)
    const ops: Record<string, AnyOp> = {}
    for (const [name, op] of Object.entries(svc.ops)) {
      if (!allows(op.modes, mode)) continue
      ops[name] = hidden.length && op.output ? { ...op, output: omitFrom(op.output, hidden) } : op
    }
    services[key] = Object.assign({ ...svc, ops }, hidden.length ? { [HIDDEN]: hidden } : {})
  }
  return { ...api, services } as TTarget
}
