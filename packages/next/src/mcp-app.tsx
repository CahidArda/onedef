/**
 * The MCP App side: what a Next.js project writes in `app/mcp-app.tsx`.
 *
 *   export default defineMcpApp(contract, {
 *     routes: {
 *       '/': HomeScreen,
 *       '/songs/:slug': { screen: SongScreen, openedBy: ['songs.get'] },   // :slug from the call's input
 *     },
 *   })
 *
 * `withOnedef()` generates the rest — the HTML page, the React root, the
 * QueryClient and the in-memory router — and bundles it into the single file
 * an MCP host renders. The screens are the website's own components: routes
 * hand them their params as props, and the result of the tool call that
 * opened the app is already in the query cache under the key the screen reads,
 * so the first screen renders without a second tool call.
 */
import { applyHostTheme, launch as launched } from '@onedef/mcp/app'
import { opKey } from '@onedef/query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createContext,
  StrictMode,
  useCallback,
  useContext,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createRoot } from 'react-dom/client'
import type { AnyService, Api, InputOf, OutputOf } from 'onedef'
import { hrefOf, matchHref, type AnyTarget, type ParamNames, type RouteParams, type Target } from './routes.js'

export { hrefOf, matchHref, type AnyTarget, type ParamNames, type RouteParams, type Target } from './routes.js'

type Services<TApi> = TApi extends Api<infer TServices, any> ? TServices : never
type OpsOf<TService> = TService extends { ops: infer TOps } ? TOps : never

/** Every op of a contract as `'service.op'`. */
export type OpRef<TApi> = {
  [S in keyof Services<TApi> & string]: `${S}.${keyof OpsOf<Services<TApi>[S]> & string}`
}[keyof Services<TApi> & string]

/** The tool call that opened the app, typed by its op. `result` is absent when the host has not sent it. */
export interface LaunchCall<TInput, TOutput> {
  input: TInput
  result: TOutput | undefined
}

/** The ops whose input has every param of the pattern, so the params can be read from it by name. */
type OpsCarrying<TApi, TPattern extends string> = {
  [R in OpRef<TApi>]: R extends `${infer S}.${infer O}`
    ? [ParamNames<TPattern>] extends [keyof InputOf<TApi, S, O>]
      ? R
      : never
    : never
}[OpRef<TApi>]

/**
 * Which tool calls open a route. A list of ops: the route's params are read
 * from the call's input by name (`:slug` ← `input.slug`), so every op listed
 * must have those fields. Or, when names differ, a function per op that
 * returns the params.
 */
export type OpenedBy<TApi, TPattern extends string> =
  | readonly OpsCarrying<TApi, TPattern>[]
  | ({
      [R in OpRef<TApi>]?: R extends `${infer S}.${infer O}`
        ? (call: LaunchCall<InputOf<TApi, S, O>, OutputOf<TApi, S, O>>) => RouteParams<TPattern>
        : never
    } & { length?: never }) // an array is an object too: keep lists out of this branch

/** One route: its screen, or its screen and the tool calls that open it. */
export type RouteEntry<TApi, TPattern extends string> =
  | ComponentType<RouteParams<TPattern>>
  | { screen: ComponentType<RouteParams<TPattern>>; openedBy?: OpenedBy<TApi, TPattern> }

/** A route table: patterns to screens. */
export type Routes = Record<string, ComponentType<any> | { screen: ComponentType<any>; openedBy?: unknown }>

export interface McpAppOptions<TApi, TRoutes extends Record<string, unknown>> {
  /**
   * Path patterns to screens. A route that a tool call should open says so
   * with `openedBy`; the others are reached by navigating.
   */
  // a mapped type over the keys, so each entry is typed (and checked) by its own pattern
  routes: { [P in keyof TRoutes & string]: RouteEntry<TApi, P> }
  /** Where the app opens when no route is `openedBy` the call. Default: `/`, else the first route. */
  fallback?: Target<TRoutes>
  /** Wraps every screen: providers, header, frame. */
  layout?: ComponentType<{ children: ReactNode }>
  /**
   * The QueryClient the screens read from. Default: refetch on focus off (in a
   * host, focus moves in and out of the iframe constantly, and every refetch
   * is a tool call) and a minute of freshness.
   */
  queryClient?: QueryClient | (() => QueryClient)
  /** Follow the host's light/dark theme on `<html>` (class `dark` + the host's CSS variables). Default `true`. */
  theme?: boolean
  /** The document around the app. */
  document?: { title?: string; htmlClassName?: string; bodyClassName?: string; rootClassName?: string }
}

export interface McpApp<TApi, TRoutes extends Record<string, unknown>> {
  readonly contract: TApi
  readonly options: McpAppOptions<TApi, TRoutes>
  /** A link to a route, typed by the route table. */
  Link: (props: LinkProps<Target<TRoutes>>) => ReactNode
  /** Navigate to a route, typed by the route table. */
  useNavigate(): (target: Target<TRoutes>) => void
  /** The current route and its params. */
  useRoute(): { to: keyof TRoutes & string; params: Record<string, string> }
}

export type LinkProps<TTarget> = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to: TTarget
  children?: ReactNode
}

/**
 * Declare the MCP App. The default export of `app/mcp-app.tsx`. Identity at
 * runtime apart from the typed helpers it returns; its job is checking — an
 * `openedBy` op the contract lacks, an op whose input lacks a route param, or
 * a screen whose props do not fit its pattern are compile errors.
 */
export function defineMcpApp<TApi extends Api<any, any>, const TRoutes extends Record<string, unknown>>(
  contract: TApi,
  options: McpAppOptions<TApi, TRoutes>,
): McpApp<TApi, TRoutes> {
  openers(options.routes) // one route per opening op, checked now rather than inside someone's chat
  return {
    contract,
    options,
    Link: ({ to, ...rest }) => <RouterLink to={to as AnyTarget} {...rest} />,
    useNavigate: () => useMcpRouter().navigate,
    useRoute: () => {
      const { route } = useMcpRouter()
      return { to: route.to as keyof TRoutes & string, params: route.params ?? {} }
    },
  }
}

// --- the in-memory router ---------------------------------------------------

/**
 * What the router offers code that does not know the route table — an adapter
 * that plugs it into a component library's own navigation, say. `navigate`
 * takes a target or an href (matched against the route patterns).
 */
export interface McpRouter {
  route: AnyTarget
  href: string
  pathname: string
  navigate: (to: AnyTarget | string) => void
  Link: (
    props: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; children?: ReactNode },
  ) => ReactNode
}

const RouterContext = createContext<McpRouter | null>(null)

/** The router, for adapters and layouts. Throws outside an app mounted by `mount()`. */
export function useMcpRouter(): McpRouter {
  const router = useContext(RouterContext)
  if (!router) throw new Error('@onedef/next: useMcpRouter() is only available inside the MCP App')
  return router
}

function RouterLink({
  to,
  onClick,
  ...rest
}: { to: AnyTarget | string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { navigate } = useMcpRouter()
  const href = typeof to === 'string' ? to : hrefOf(to)
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(to)
  }
  return <a href={href} onClick={follow} {...rest} />
}

/**
 * State is just the current target: no `history`, because the sandboxed
 * iframe has no address bar and pushing entries would only fight the host's
 * own navigation.
 */
function Router({ app, initial }: { app: McpApp<any, Routes>; initial: AnyTarget }) {
  const { routes, layout: Layout } = app.options
  const patterns = useMemo(() => Object.keys(routes), [routes])
  const [route, setRoute] = useState(initial)

  const navigate = useCallback(
    (to: AnyTarget | string) => {
      const next = typeof to === 'string' ? matchHref(patterns, to) : to
      if (!next || !(next.to in routes)) {
        console.warn(`@onedef/next: no MCP App route for ${typeof to === 'string' ? to : to.to}`)
        return
      }
      setRoute(next)
      window.scrollTo({ top: 0 })
    },
    [patterns, routes],
  )

  const router = useMemo<McpRouter>(() => {
    const href = hrefOf(route)
    return {
      route,
      href,
      pathname: href,
      navigate,
      Link: ({ href: to, ...rest }) => <RouterLink to={to} {...rest} />,
    }
  }, [route, navigate])

  const Screen = screenOf(routes[route.to]!)
  // keyed by href: each navigation is a fresh screen, as on the web
  const screen = <Screen key={router.href} {...route.params} />
  return <RouterContext.Provider value={router}>{Layout ? <Layout>{screen}</Layout> : screen}</RouterContext.Provider>
}

// --- routes --------------------------------------------------------------------

const screenOf = (entry: Routes[string]): ComponentType<any> =>
  typeof entry === 'object' && entry !== null && 'screen' in entry ? entry.screen : (entry as ComponentType<any>)

type Opener = { pattern: string; params: (call: LaunchCall<unknown, unknown>) => Record<string, string> }

/** For each op that opens a route: the route, and how its params come from the call. */
function openers(routes: Routes): Map<string, Opener> {
  const map = new Map<string, Opener>()
  for (const [pattern, entry] of Object.entries(routes)) {
    const openedBy = typeof entry === 'object' && entry !== null && 'screen' in entry ? entry.openedBy : undefined
    if (!openedBy) continue
    const names = [...pattern.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]!)
    const byName = (call: LaunchCall<unknown, unknown>) => {
      const input = (call.input ?? {}) as Record<string, unknown>
      return Object.fromEntries(names.map((name) => [name, String(input[name])]))
    }
    const entries: [string, Opener['params']][] = Array.isArray(openedBy)
      ? openedBy.map((op: string) => [op, byName])
      : Object.entries(openedBy as Record<string, (call: LaunchCall<unknown, unknown>) => Record<string, string>>)
    for (const [op, params] of entries) {
      if (map.has(op)) {
        throw new Error(
          `@onedef/next: ${op} opens both ${map.get(op)!.pattern} and ${pattern}; a tool call opens one route`,
        )
      }
      map.set(op, { pattern, params })
    }
  }
  return map
}

// --- mounting ----------------------------------------------------------------

const defaultQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 60_000 } } })

/**
 * Render the app: resolve which tool call opened it, put that call's result in
 * the query cache, and open the route that call is `openedBy`. Called by the generated
 * root; call it yourself only when hosting the app outside `withOnedef()`.
 */
export async function mount(app: McpApp<any, Routes>, element?: HTMLElement | null): Promise<void> {
  const { options, contract } = app
  const doc = options.document ?? {}
  if (doc.title) document.title = doc.title
  if (doc.htmlClassName) document.documentElement.classList.add(...doc.htmlClassName.split(/\s+/).filter(Boolean))
  if (doc.bodyClassName) document.body.classList.add(...doc.bodyClassName.split(/\s+/).filter(Boolean))

  if (options.theme !== false) {
    // the host owns the theme; until it says (or outside a host), follow the OS
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark')
    applyHostTheme()
  }

  const queryClient =
    typeof options.queryClient === 'function' ? options.queryClient() : (options.queryClient ?? defaultQueryClient())

  const patterns = Object.keys(options.routes)
  const fallback: AnyTarget =
    (options.fallback as AnyTarget | undefined) ?? (patterns.includes('/') ? { to: '/' } : { to: patterns[0]! })

  let initial = fallback
  const call = await launched(contract).catch(() => undefined)
  if (call) {
    seed(queryClient, contract, call.service, call.op, call.input, call.result)
    const opener = openers(options.routes).get(`${call.service}.${call.op}`)
    if (opener) {
      try {
        initial = { to: opener.pattern, params: opener.params({ input: call.input, result: call.result }) }
      } catch (error) {
        console.warn('@onedef/next: could not open the route for this tool call, opening the fallback', error)
      }
    }
  }

  const root = element ?? document.getElementById('root')
  if (!root) throw new Error('@onedef/next: no #root element to mount the MCP App into')
  if (doc.rootClassName) root.className = doc.rootClassName
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Router app={app} initial={initial} />
      </QueryClientProvider>
    </StrictMode>,
  )
}

/**
 * Write the launching call's result where a screen will read it: a query op's
 * own key, or — for an action that returns the object (`output` is the
 * resource's `fields`) — that object's `get` key. The same rule
 * `@onedef/query` applies after a mutation.
 */
function seed(
  queryClient: QueryClient,
  contract: Api,
  service: string,
  op: string,
  input: unknown,
  result: unknown,
): void {
  if (result === undefined) return
  const svc = contract.services[service] as AnyService | undefined
  const def = svc?.ops[op]
  if (!svc || !def) return
  if (def.kind === 'query') {
    queryClient.setQueryData(opKey(service, op, input), result)
    return
  }
  const fields = svc.resource?.fields
  if (fields && def.output === fields && svc.ops.get) {
    const id = svc.id
      ? ((result as Record<string, unknown>)[svc.id] ?? (input as Record<string, unknown>)?.[svc.id])
      : undefined
    queryClient.setQueryData(opKey(service, 'get', svc.id && id !== undefined ? { [svc.id]: id } : {}), result)
  }
}
