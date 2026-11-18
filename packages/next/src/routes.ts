/**
 * Typed routes for the MCP App's in-memory router. A route is a path pattern
 * (`/songs/:slug`); its params are read out of the pattern by the type system,
 * so a target `{ to: '/songs/:slug', params: { slug } }` is checked against
 * the route table — a wrong route, a missing or extra param is a compile error,
 * not a blank screen inside someone's chat.
 */

/** `'/songs/:slug/lines/:n'` → `'slug' | 'n'`. */
export type ParamNames<TPattern extends string> = TPattern extends `${string}:${infer TName}/${infer TRest}`
  ? TName | ParamNames<`/${TRest}`>
  : TPattern extends `${string}:${infer TName}`
    ? TName
    : never

/** `'/songs/:slug'` → `{ slug: string }`. */
export type RouteParams<TPattern extends string> = { [K in ParamNames<TPattern>]: string }

/** Where to go: a route of the table, with exactly that route's params. */
export type Target<TRoutes> = {
  [K in keyof TRoutes & string]: [ParamNames<K>] extends [never]
    ? { to: K; params?: Record<string, never> }
    : { to: K; params: RouteParams<K> }
}[keyof TRoutes & string]

/** Any target, for code that does not know the route table. */
export interface AnyTarget {
  to: string
  params?: Record<string, string>
}

/** A target as an href: `{ to: '/songs/:slug', params: { slug: 'a b' } }` → `/songs/a%20b`. */
export function hrefOf(target: AnyTarget): string {
  return target.to.replace(/:([A-Za-z0-9_]+)/g, (_, name: string) => {
    const value = target.params?.[name]
    if (value === undefined) throw new Error(`@onedef/next: route "${target.to}" needs a "${name}" param`)
    return encodeURIComponent(value)
  })
}

/**
 * The route an href lands on, with its params — so components that only know
 * hrefs (a shared `<Link href="/songs/x">`) still navigate the typed router.
 * Static segments win over params at the same position, as in every router.
 */
export function matchHref(patterns: readonly string[], href: string): AnyTarget | undefined {
  const path = (href.split(/[?#]/)[0] || '/').replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  const ranked = [...patterns].sort((a, b) => specificity(b) - specificity(a))
  for (const pattern of ranked) {
    const segments = pattern.split('/').filter(Boolean)
    if (segments.length !== parts.length) continue
    const params: Record<string, string> = {}
    const ok = segments.every((segment, i) => {
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(parts[i]!)
        return true
      }
      return segment === parts[i]
    })
    if (ok) return Object.keys(params).length ? { to: pattern, params } : { to: pattern }
  }
  return undefined
}

const specificity = (pattern: string) =>
  pattern
    .split('/')
    .filter(Boolean)
    .reduce((score, segment) => score * 2 + (segment.startsWith(':') ? 0 : 1), 1)
