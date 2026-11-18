import type { AnyOp, Api, ScopeDef } from './contract.js'
import { ApiError } from './errors.js'

export interface NamedScope extends ScopeDef {
  name: string
}

export type ScopeValues = Record<string, string | undefined>

/** The scopes one op declares, resolved against the config's registry. */
export function scopesOf(api: Api, op: AnyOp): NamedScope[] {
  return (op.scope ?? []).map((name) => ({ ...api.config.scopes![name]!, name }))
}

/**
 * Check scope values for one op and render them as headers. A required scope
 * with no value throws before anything is sent: the dangerous failure here is
 * not an error, it is a plausible-looking response from the wrong tenant.
 */
export function scopeHeaders(
  api: Api,
  op: AnyOp,
  values: ScopeValues | undefined,
  where: string,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const scope of scopesOf(api, op)) {
    const value = values?.[scope.name]
    if (value === undefined || value === '') {
      if (scope.required) {
        throw new ApiError(
          'INVALID_INPUT',
          `${where} runs in a "${scope.name}" scope (${scope.header}) but none was given. ` +
            `Pass { scope: { ${scope.name}: '...' } } rather than letting the call fall back to another tenant.`,
        )
      }
      continue
    }
    headers[scope.header] = value
  }
  return headers
}

/** Every declared scope header of a request, read back into `{ name: value }`. */
export function scopeFromHeaders(api: Api, headers: Headers): ScopeValues {
  return Object.fromEntries(
    Object.entries(api.config.scopes ?? {}).map(([name, def]) => [name, headers.get(def.header) ?? undefined]),
  )
}
