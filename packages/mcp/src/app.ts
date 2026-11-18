import { ApiError, eachOp, toolName, type Api, type InputOf, type OutputOf, type Transport } from 'onedef'

/**
 * The browser side of an MCP App: the same UI that calls your backend on the
 * web calls it through the MCP host when it runs inside a chat.
 *
 *   export const client = createClient(contract, mcpApp() ?? rpc({ url: '/api' }))
 *
 * Hand-rolled JSON-RPC 2.0 over `postMessage` instead of the official
 * `@modelcontextprotocol/ext-apps` (≈148 KB gzipped, mostly zod): an app only
 * needs a handful of messages, and every byte here ships inside the iframe.
 */

/** What the host tells the app about where it is rendered. */
export interface HostContext {
  theme?: 'light' | 'dark'
  displayMode?: 'inline' | 'fullscreen' | 'pip'
  availableDisplayModes?: string[]
  locale?: string
  timeZone?: string
  platform?: 'web' | 'desktop' | 'mobile'
  safeAreaInsets?: { top: number; right: number; bottom: number; left: number }
  containerDimensions?: { width?: number; height?: number; maxWidth?: number; maxHeight?: number }
  /** CSS custom properties (`--color-background-primary`, …) to blend in with the host. */
  styles?: { variables?: Record<string, string | undefined> }
  /** The tool call that opened the app. */
  toolInfo?: { id?: string | number; tool: { name: string } }
  [key: string]: unknown
}

/** @internal What the client talks to: `window.parent` in a real host, a fake in tests. */
export interface HostPort {
  send(message: object): void
  listen(onMessage: (message: unknown) => void): void
}

export interface McpAppOptions {
  /** Shown to the host as `appInfo`. Default: `document.title`. */
  name?: string
  version?: string
  /** How long a host request may take before it fails with `UNAVAILABLE`. Default 60 s. */
  timeout?: number
  /** Report the content size so the host sizes the iframe. Default true. */
  autoResize?: boolean
}

interface ToolResult {
  content?: { type: string; text?: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

interface Message {
  jsonrpc?: string
  id?: string | number
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

const PROTOCOL_VERSION = '2026-01-26'

/** Inside an MCP App? The server injects this marker into the HTML it serves, so no handshake is needed to know. */
const inApp = () => Boolean((globalThis as { __ONEDEF_MCP_APP__?: unknown }).__ONEDEF_MCP_APP__)

/** A tool result back into what the op returned — the exact inverse of the server's `toolResult()`. */
function unwrap(result: ToolResult): unknown {
  const meta = result._meta ?? {}
  const text = result.content?.find((item) => item.type === 'text')?.text
  if (result.isError) {
    const declared = meta['onedef/error'] as { code: string; status?: number; data?: unknown } | undefined
    const parsed = /^([A-Z][A-Z0-9_]*): ([\s\S]*)$/.exec(text ?? '')
    const code = declared?.code ?? parsed?.[1] ?? 'INTERNAL'
    const message = parsed && parsed[1] === code ? parsed[2] : (text ?? 'Tool call failed')
    throw new ApiError(code, message, {
      ...(declared?.status ? { status: declared.status } : {}),
      ...(declared?.data !== undefined ? { data: declared.data } : {}),
    })
  }
  if (result.structuredContent !== undefined) {
    return meta['onedef/wrapped'] ? result.structuredContent.result : result.structuredContent
  }
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const windowPort = (): HostPort => ({
  send: (message) => window.parent.postMessage(message, '*'),
  listen: (onMessage) =>
    window.addEventListener('message', (event) => {
      // only the host may talk to us — not frames the app embeds itself
      if (event.source === window.parent) onMessage(event.data)
    }),
})

type Listener<T> = (value: T) => void

class Session {
  private nextId = 1
  private pending = new Map<string | number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  private contextListeners = new Set<Listener<HostContext>>()
  private resultListeners = new Set<Listener<ToolResult>>()
  private inputWaiters: Listener<Record<string, unknown>>[] = []
  context: HostContext | undefined
  toolInput: Record<string, unknown> | undefined
  toolResult: ToolResult | undefined
  readonly ready: Promise<HostContext>

  constructor(
    private port: HostPort,
    private options: McpAppOptions,
  ) {
    port.listen((message) => this.receive(message as Message))
    this.ready = this.request('ui/initialize', {
      protocolVersion: PROTOCOL_VERSION,
      appInfo: {
        name: options.name ?? (typeof document === 'undefined' ? 'onedef-app' : document.title || 'onedef-app'),
        version: options.version ?? '0.0.0',
      },
      appCapabilities: {},
    }).then((init: { hostContext?: HostContext }) => {
      this.setContext(init.hostContext ?? {})
      this.notify('ui/notifications/initialized', {})
      if (options.autoResize !== false) this.autoResize()
      return this.context!
    })
    this.ready.catch(() => {}) // reported by whichever call awaits it
  }

  request(method: string, params: object): Promise<any> {
    const id = this.nextId++
    const timeout = this.options.timeout ?? 60_000
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new ApiError('UNAVAILABLE', `The MCP host did not answer ${method} within ${timeout} ms`))
      }, timeout)
      const settle =
        <T>(fn: (value: T) => void) =>
        (value: T) => {
          clearTimeout(timer)
          this.pending.delete(id)
          fn(value)
        }
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) })
      this.port.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: object): void {
    this.port.send({ jsonrpc: '2.0', method, params })
  }

  private receive(message: Message): void {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return
    if (message.method === undefined) {
      const waiter = message.id === undefined ? undefined : this.pending.get(message.id)
      if (message.error) waiter?.reject(new ApiError('INTERNAL', message.error.message, { data: message.error }))
      else waiter?.resolve(message.result)
      return
    }
    if (message.id !== undefined) {
      // host → app requests: teardown needs only an acknowledgement
      const known = message.method === 'ui/resource-teardown' || message.method === 'ping'
      this.port.send(
        known
          ? { jsonrpc: '2.0', id: message.id, result: {} }
          : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } },
      )
      return
    }
    const params = message.params ?? {}
    if (message.method === 'ui/notifications/tool-input') {
      this.toolInput = (params.arguments as Record<string, unknown>) ?? {}
      for (const waiter of this.inputWaiters.splice(0)) waiter(this.toolInput)
    } else if (message.method === 'ui/notifications/tool-result') {
      this.toolResult = params as ToolResult
      for (const listener of this.resultListeners) listener(this.toolResult)
    } else if (message.method === 'ui/notifications/host-context-changed') {
      this.setContext({ ...this.context, ...params })
    }
  }

  private setContext(context: HostContext): void {
    this.context = context
    for (const listener of this.contextListeners) listener(context)
  }

  onContext(listener: Listener<HostContext>): () => void {
    this.contextListeners.add(listener)
    if (this.context) listener(this.context)
    return () => this.contextListeners.delete(listener)
  }

  onResult(listener: Listener<ToolResult>): () => void {
    this.resultListeners.add(listener)
    if (this.toolResult) listener(this.toolResult)
    return () => this.resultListeners.delete(listener)
  }

  input(waitMs: number): Promise<Record<string, unknown>> {
    if (this.toolInput) return Promise.resolve(this.toolInput)
    return new Promise((resolve) => {
      const done = (input: Record<string, unknown>) => {
        clearTimeout(timer)
        resolve(input)
      }
      const timer = setTimeout(() => {
        this.inputWaiters = this.inputWaiters.filter((waiter) => waiter !== done)
        resolve({})
      }, waitMs)
      this.inputWaiters.push(done)
    })
  }

  private autoResize(): void {
    if (typeof ResizeObserver === 'undefined' || typeof document === 'undefined') return
    const html = document.documentElement
    let last = ''
    const report = () => {
      // measure the content, not the iframe: with a fixed height the page can never shrink
      const previous = html.style.height
      html.style.height = 'max-content'
      const rect = html.getBoundingClientRect()
      html.style.height = previous
      const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) }
      if (`${size.width}x${size.height}` === last) return
      last = `${size.width}x${size.height}`
      this.notify('ui/notifications/size-changed', size)
    }
    const observer = new ResizeObserver(report)
    observer.observe(html)
    if (document.body) observer.observe(document.body)
    report()
  }
}

let session: Session | undefined
let config: McpAppOptions = {}

const current = (): Session | undefined => (inApp() ? (session ??= new Session(windowPort(), config)) : undefined)

/**
 * @internal Talk to a given host instead of `window.parent` — for tests and
 * custom embedders. Replaces the current session.
 */
export function connect(port: HostPort, options: McpAppOptions = {}): void {
  session = new Session(port, { ...config, ...options })
}

/**
 * A transport that turns each call into a `tools/call` to the MCP host, or
 * `undefined` outside an MCP App — hence `mcpApp() ?? rpc({ url })`. The
 * handshake starts on the first call of this function, so call it early
 * (where the client is created) for the host to send the launch input sooner.
 */
export function mcpApp(options: McpAppOptions = {}): Transport | undefined {
  if (!inApp()) return undefined
  if (!session) config = options
  const host = current()!
  return async (call, api) => {
    if (call.signal?.aborted) throw call.signal.reason
    await host.ready
    const pending = host.request('tools/call', { name: toolName(api, call.service, call.op), arguments: call.input })
    const result: ToolResult = call.signal
      ? await Promise.race([
          pending,
          new Promise<never>((_, reject) => call.signal!.addEventListener('abort', () => reject(call.signal!.reason))),
        ])
      : await pending
    return unwrap(result)
  }
}

/** The tool call that opened the app, typed by the contract. */
export type Launch<TApi> =
  TApi extends Api<infer TServices, any>
    ? {
        [S in keyof TServices & string]: {
          [O in keyof TServices[S]['ops'] & string]: {
            service: S
            op: O
            input: InputOf<TApi, S, O>
            /** Present once the host has sent the tool's result (usually right after launch). */
            result?: OutputOf<TApi, S, O>
            error?: ApiError
          }
        }[keyof TServices[S]['ops'] & string]
      }[keyof TServices & string]
    : never

/**
 * Which tool call opened the app — `{ service: 'songs', op: 'get', input: { slug } }` —
 * so the UI can route to the right screen. `undefined` outside an MCP App, or
 * when the host does not say. Waits briefly (`waitMs`, default 3 s) for the
 * host's tool-input; subscribe with `onToolResult` for the result if it is
 * not in yet.
 */
export async function launch<TApi extends Api<any, any>>(
  api: TApi,
  options: { waitMs?: number } = {},
): Promise<Launch<TApi> | undefined> {
  const host = current()
  if (!host) return undefined
  const context = await host.ready
  const name = context.toolInfo?.tool.name
  const found = name ? eachOp(api).find(({ key, name: op }) => toolName(api, key, op) === name) : undefined
  if (!found) return undefined
  const waitMs = options.waitMs ?? 3_000
  const input = await host.input(waitMs)
  // The host sends the result once the tool finishes, usually right after the
  // input. Waiting for it (briefly) means the UI renders from the call that
  // opened it instead of making the same call again.
  const raw =
    host.toolResult ??
    (await new Promise<ToolResult | undefined>((resolve) => {
      const timer = setTimeout(() => (stop(), resolve(undefined)), waitMs)
      const stop = host.onResult((result) => (clearTimeout(timer), stop(), resolve(result)))
    }))
  const outcome: { result?: unknown; error?: ApiError } = {}
  if (raw) {
    try {
      outcome.result = unwrap(raw)
    } catch (error) {
      outcome.error = error as ApiError
    }
  }
  return { service: found.key, op: found.name, input, ...outcome } as Launch<TApi>
}

/**
 * The launching tool's result, as the op returned it — replayed if it already
 * arrived, and again whenever the host sends a new one. Returns an unsubscribe.
 */
export function onToolResult(listener: (result: unknown, error?: ApiError) => void): () => void {
  return (
    current()?.onResult((raw) => {
      try {
        listener(unwrap(raw))
      } catch (error) {
        listener(undefined, error as ApiError)
      }
    }) ?? (() => {})
  )
}

/** The latest host context (theme, display mode, safe area, styles); `undefined` before the handshake or outside an app. */
export const hostContext = (): HostContext | undefined => current()?.context

/** Called with the host context once known and on every change. Returns an unsubscribe. */
export const onHostContextChanged = (listener: (context: HostContext) => void): (() => void) =>
  current()?.onContext(listener) ?? (() => {})

/**
 * Follow the host's theme: `class="dark"`, `data-theme` and `color-scheme` on
 * `<html>`, plus the host's CSS variables. Opt-in, because a UI with its own
 * theming may want only some of it. Returns an unsubscribe.
 */
export function applyHostTheme(): () => void {
  return onHostContextChanged((context) => {
    const html = document.documentElement
    if (context.theme) {
      html.classList.toggle('dark', context.theme === 'dark')
      html.dataset.theme = context.theme
      html.style.colorScheme = context.theme
    }
    for (const [name, value] of Object.entries(context.styles?.variables ?? {})) {
      if (value) html.style.setProperty(name, value)
    }
  })
}

const host = async (method: string, params: object) => {
  const session = current()
  if (!session) throw new Error(`onedef: ${method} is only available inside an MCP App`)
  await session.ready
  return session.request(method, params)
}

/** Open a URL in the user's browser — through the host (iframes cannot navigate away), or `window.open` on the web. */
export async function openLink(url: string): Promise<void> {
  if (!inApp()) return void window.open(url, '_blank', 'noopener')
  await host('ui/open-link', { url })
}

/** Post a message into the conversation as the user, e.g. "Explain this verse". */
export async function sendMessage(text: string): Promise<void> {
  await host('ui/message', { role: 'user', content: [{ type: 'text', text }] })
}

/** Ask for another display mode; resolves to the mode the host granted. */
export async function requestDisplayMode(mode: 'inline' | 'fullscreen' | 'pip'): Promise<string> {
  const result = (await host('ui/request-display-mode', { mode })) as { mode?: string }
  return result?.mode ?? mode
}
