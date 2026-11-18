import {
  credentialsFromEnv,
  eachOp,
  http,
  isApiError,
  isBackend,
  local,
  scopeFromHeaders,
  scopesOf,
  toJsonSchema,
  toolName,
  type AnyOp,
  type AnyService,
  type Api,
  type Backend,
  type Credentials,
  type JsonSchema,
  type OpRef,
  type ScopeValues,
  type Transport,
} from 'onedef'
// type-only: erased at build, so the SDK stays an optional, lazily imported peer
import type { CallToolResult, McpServer, StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server'

/** One MCP tool as plain data — what `attach()` registers, and easy to inspect in tests. */
export interface McpTool {
  name: string
  /** The op this tool calls. */
  service: string
  op: string
  title: string
  description: string
  inputSchema: JsonSchema
  outputSchema?: JsonSchema
  annotations: ToolAnnotations
  _meta?: Record<string, unknown>
  handler: (args: Record<string, unknown>, context: ToolCallContext) => Promise<unknown>
}

/** Who a tool call is made for: the inbound request (HTTP) or env credentials (stdio). */
export interface ToolCallContext {
  request?: Request
  auth?: Credentials
  /** Scope values bound to the server (`'bound'` mode): request headers or stdio config. */
  scope?: ScopeValues
}

export interface McpToolsOptions {
  /** Who answers each call: `local(backend)`, `http()`, `rpc({ url })`, … */
  transport: Transport
  /**
   * Scope is ambient on every surface except this one: an agent has no ambient team.
   *
   * `'bound'` (default) pins scope outside the model — request headers over
   * HTTP, config for stdio — and keeps it out of the tool schemas entirely.
   *
   * `'explicit'` adds one parameter per scope to every scoped tool. Only right
   * for genuinely multi-tenant servers that also expose a way to discover the
   * values: a required parameter the agent cannot obtain gets hallucinated.
   */
  scopeMode?: 'bound' | 'explicit'
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]'

/**
 * Schemas go to the SDK as JSON Schema with a pass-through validator: the
 * contract validates input itself (with its own validator and error codes),
 * and compiling every schema with ajv on each per-request server would be
 * pure overhead.
 */
const passThrough = (schema: JsonSchema): StandardSchemaWithJSON<Record<string, unknown>> => ({
  '~standard': {
    version: 1,
    vendor: 'onedef',
    jsonSchema: { input: () => schema, output: () => schema },
    validate: (value) => ({ value: value as Record<string, unknown> }),
  },
})

function toolFor(api: Api, key: string, svc: AnyService, name: string, op: AnyOp, options: McpToolsOptions): McpTool {
  const scopes = options.scopeMode === 'explicit' ? scopesOf(api, op) : []
  const member = op.on === 'member' ? svc.id! : undefined
  const input = toJsonSchema(op.input)
  const output = op.output ? toJsonSchema(op.output, 'output') : undefined
  const list = svc.ops.list
  const lister = member && list && list.mcp?.expose !== false ? toolName(api, key, 'list') : undefined

  const description = [
    op.description ? `${op.summary}. ${op.description}` : op.summary,
    member && `Addressed by \`${member}\`.${lister ? ` Call ${lister} first if you do not know it.` : ''}`,
    svc.description && `(${svc.name}: ${svc.description})`,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    name: toolName(api, key, name),
    service: key,
    op: name,
    title: op.summary,
    description,
    inputSchema: {
      ...input,
      type: 'object',
      properties: {
        ...(member ? { [member]: { type: 'string', description: `The ${svc.name} ${member}` } } : {}),
        ...Object.fromEntries(scopes.map((scope) => [scope.name, { type: 'string', description: scope.description }])),
        ...(input.properties ?? {}),
      },
      required: [
        ...new Set([
          ...(member ? [member] : []),
          ...scopes.filter((scope) => scope.required).map((scope) => scope.name),
          ...(input.required ?? []),
        ]),
      ],
    },
    // MCP requires structuredContent to match outputSchema, and structuredContent
    // must be an object — so a list result cannot declare one.
    ...(output?.type === 'object' ? { outputSchema: output } : {}),
    annotations:
      op.kind === 'query'
        ? { title: op.summary, readOnlyHint: true, openWorldHint: true }
        : {
            title: op.summary,
            readOnlyHint: false,
            destructiveHint: op.destructive ?? false,
            idempotentHint: op.idempotent ?? false,
            openWorldHint: true,
          },
    handler: (args, context) => {
      const names = new Set(scopes.map((scope) => scope.name))
      const explicit = Object.fromEntries(
        Object.entries(args).filter(([arg, value]) => names.has(arg) && value),
      ) as ScopeValues
      const input = Object.fromEntries(Object.entries(args).filter(([arg]) => !names.has(arg)))
      return options.transport(
        {
          service: key,
          op: name,
          input,
          scope: { ...context.scope, ...explicit },
          ...(context.request ? { request: context.request } : {}),
          ...(context.auth ? { auth: context.auth } : {}),
        },
        api,
      )
    },
  }
}

/** One tool per op (minus `mcp.expose: false`). Returns data, not a server, so it works with any MCP host. */
export function toMcpTools(api: Api, options: McpToolsOptions): McpTool[] {
  return eachOp(api)
    .filter(({ op }) => op.mcp?.expose !== false)
    .map(({ key, svc, name, op }) => toolFor(api, key, svc, name, op, options))
}

/**
 * A value as a tool result. `structuredContent` must be an object, so anything
 * else is wrapped as `{ result }` and flagged — the MCP App client unwraps it,
 * so a UI gets back exactly what the op returned.
 */
export function toolResult(value: unknown): CallToolResult {
  const text = JSON.stringify(value, null, 2) ?? 'null'
  return isPlainObject(value)
    ? { content: [{ type: 'text', text }], structuredContent: value }
    : { content: [{ type: 'text', text }], structuredContent: { result: value }, _meta: { 'onedef/wrapped': true } }
}

/** A thrown `ApiError` as a tool error the model can read and the app client can rebuild. */
export function toolError(error: unknown): CallToolResult {
  if (!isApiError(error)) throw error
  return {
    content: [{ type: 'text', text: `${error.code}: ${error.message}` }],
    isError: true,
    _meta: {
      'onedef/error': {
        code: error.code,
        status: error.status,
        ...(error.data !== undefined ? { data: error.data } : {}),
      },
    },
  }
}

/** Register tools on an SDK server. `context` says who every call is made for. */
export function attach(server: McpServer, tools: McpTool[], context: ToolCallContext = {}): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: passThrough(tool.inputSchema),
        ...(tool.outputSchema ? { outputSchema: passThrough(tool.outputSchema) } : {}),
        annotations: tool.annotations,
        ...(tool._meta ? { _meta: tool._meta } : {}),
      },
      async (args) => {
        try {
          return toolResult(await tool.handler(args ?? {}, context))
        } catch (error) {
          return toolError(error)
        }
      },
    )
  }
}

// ── MCP App ────────────────────────────────────────────────────────────────

export interface McpAppOptions<TRef extends string = string> {
  /**
   * The UI: one self-contained HTML file (any framework, bundled inline),
   * served to the host as the `ui://` resource. A string, or a function read
   * per `resources/read` (e.g. from your build output). With Next.js,
   * `serveMcpApp()` from `@onedef/next/server` fills this in.
   */
  html: string | (() => string | Promise<string>)
  /**
   * Ops whose tool calls open the UI, as `'songs.get'` — checked against the
   * contract. Default: every query op. Every tool stays callable from the UI.
   */
  tools?: TRef[]
  title?: string
  /** Origins the sandboxed iframe may reach; hosts deny everything else. */
  csp?: { connectDomains?: string[]; resourceDomains?: string[]; frameDomains?: string[]; baseUriDomains?: string[] }
  prefersBorder?: boolean
  /** A dedicated sandbox origin, for hosts that support one. */
  domain?: string
}

const APP_MIME = 'text/html;profile=mcp-app'

/** The marker `mcpApp()` looks for: how the UI knows, synchronously, that it runs inside an MCP App. */
export const APP_MARKER = '<script>window.__ONEDEF_MCP_APP__={v:1}</script>'

/** Put the marker first in `<head>` (before any app script runs), or at the very start. */
export function injectMarker(html: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (!head) return APP_MARKER + html
  const at = head.index + head[0].length
  return html.slice(0, at) + APP_MARKER + html.slice(at)
}

function appTools(api: Api, tools: McpTool[], app: McpAppOptions): McpTool[] {
  const resourceUri = `ui://${api.config.name}/app.html`
  const refs = new Set(
    app.tools ??
      eachOp(api)
        .filter(({ op }) => op.kind === 'query')
        .map(({ key, name }) => `${key}.${name}`),
  )
  for (const ref of refs) {
    if (!tools.some((tool) => `${tool.service}.${tool.op}` === ref)) {
      throw new Error(`onedef: app.tools names "${ref}", which is not an exposed op of the contract`)
    }
  }
  const _meta = { ui: { resourceUri, visibility: ['model', 'app'] }, 'ui/resourceUri': resourceUri }
  return tools.map((tool) => (refs.has(`${tool.service}.${tool.op}`) ? { ...tool, _meta } : tool))
}

function registerApp(server: McpServer, api: Api, app: McpAppOptions): void {
  const uri = `ui://${api.config.name}/app.html`
  const ui = {
    ...(app.csp ? { csp: app.csp } : {}),
    ...(app.prefersBorder !== undefined ? { prefersBorder: app.prefersBorder } : {}),
    ...(app.domain ? { domain: app.domain } : {}),
  }
  server.registerResource('app', uri, { title: app.title ?? api.config.name, mimeType: APP_MIME }, async () => ({
    contents: [
      {
        uri,
        mimeType: APP_MIME,
        text: injectMarker(typeof app.html === 'function' ? await app.html() : app.html),
        // hosts read the sandbox policy from the content item, not the listing
        _meta: { ui },
      },
    ],
  }))
}

// ── Servers ────────────────────────────────────────────────────────────────

export interface McpServerOptions<TApi extends Api = Api> {
  /** Who answers calls. Default: `local(backend)` for a backend, `http()` (the ops' descriptors) for a contract. */
  transport?: Transport
  scopeMode?: 'bound' | 'explicit'
  /** Defaults: `config.name`, `config.version`, `config.description`. */
  name?: string
  version?: string
  instructions?: string
  /** Serve a UI as an MCP App alongside the tools. Without it: tools only. */
  app?: McpAppOptions<OpRef<TApi>>
}

export interface McpAuth {
  /**
   * Is this request allowed in? Verify the bearer token with your provider
   * (Clerk, Auth0, WorkOS, a JWKS…). Identity for handlers comes from
   * `context({ request })` in the backend, which sees the same request.
   */
  verify: (request: Request) => boolean | Promise<boolean>
  /** Where clients discover the authorization server (RFC 9728), e.g. `https://app.com/.well-known/oauth-protected-resource`. */
  resourceMetadataUrl: string | ((request: Request) => string)
}

export interface McpHandlerOptions<TApi extends Api = Api> extends McpServerOptions<TApi> {
  auth?: McpAuth
}

type Target = Backend<any> | Api<any, any>
/** The contract behind a backend or a contract. */
type ApiOf<TTarget> = TTarget extends Backend<infer TApi> ? TApi : TTarget extends Api ? TTarget : Api

type Sdk = typeof import('@modelcontextprotocol/server')

async function loadSdk(): Promise<Sdk> {
  try {
    return await import('@modelcontextprotocol/server')
  } catch {
    throw new Error('onedef: MCP serving needs @modelcontextprotocol/server — install it as a dependency.')
  }
}

/** Everything per-request servers share: computed once, not per request. */
function prepare(target: Target, options: McpServerOptions<any>) {
  const api: Api = isBackend(target) ? target.api : target
  const transport = options.transport ?? (isBackend(target) ? local(target) : http())
  let tools = toMcpTools(api, { transport, ...(options.scopeMode ? { scopeMode: options.scopeMode } : {}) })
  if (options.app) tools = appTools(api, tools, options.app)
  return (sdk: Sdk, context: ToolCallContext) => {
    const instructions = options.instructions ?? api.config.description
    const server = new sdk.McpServer(
      { name: options.name ?? api.config.name, version: options.version ?? api.config.version ?? '0.0.0' },
      instructions ? { instructions } : {},
    )
    attach(server, tools, context)
    if (options.app) registerApp(server, api, options.app)
    return server
  }
}

/**
 * MCP over Streamable HTTP as a web `(Request) => Promise<Response>` handler —
 * mount it in Next.js, Hono, Workers, Bun or Deno as is:
 *
 *   createMcpHandler(backend)                                   // run the handlers in process
 *   createMcpHandler(contract, { transport: rpc({ url }) })     // forward to a deployed backend
 *   createMcpHandler(backend, { app: { html, tools: ['songs.get'] } })
 *
 * Each request gets its own server (the SDK's per-request factory), so the
 * caller's request — and with it their Authorization — reaches every tool
 * call: `context({ request })` in the backend sees it, and `rpc()`/`http()`
 * forward it. A shared long-lived server would answer everyone as the first
 * caller. The SDK is imported on first use, so this package stays importable
 * (for `toMcpTools`) without it.
 */
export function createMcpHandler<TTarget extends Target>(
  target: TTarget,
  options: McpHandlerOptions<ApiOf<TTarget>> = {},
): (request: Request) => Promise<Response> {
  const build = prepare(target, options)
  const handler = loadSdk().then((sdk) =>
    sdk.createMcpHandler(({ requestInfo }) => {
      const scope = requestInfo ? scopeFromHeaders(isBackend(target) ? target.api : target, requestInfo.headers) : {}
      return build(sdk, { ...(requestInfo ? { request: requestInfo } : {}), scope })
    }),
  )
  handler.catch(() => {}) // surfaced on the first request, not as an unhandled rejection at startup
  const { auth } = options
  return async (request) => {
    if (auth && !(await auth.verify(request))) {
      const url =
        typeof auth.resourceMetadataUrl === 'function' ? auth.resourceMetadataUrl(request) : auth.resourceMetadataUrl
      return Response.json(
        { error: 'invalid_token', error_description: 'Missing or invalid access token' },
        { status: 401, headers: { 'www-authenticate': `Bearer resource_metadata="${url}"` } },
      )
    }
    return (await handler).fetch(request)
  }
}

/**
 * RFC 9728 protected-resource metadata, for providers that do not serve it:
 * mount at `/.well-known/oauth-protected-resource`. It tells MCP clients (and
 * the onedef CLI's `login`) which authorization server issues tokens for you.
 */
export function protectedResourceMetadata(options: {
  resource: string | ((request: Request) => string)
  authorizationServers: string[]
  scopes?: string[]
}): (request: Request) => Response {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' }
  return (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    return Response.json(
      {
        resource: typeof options.resource === 'function' ? options.resource(request) : options.resource,
        authorization_servers: options.authorizationServers,
        ...(options.scopes ? { scopes_supported: options.scopes } : {}),
        bearer_methods_supported: ['header'],
      },
      { headers: cors },
    )
  }
}

export interface McpStdioOptions<TApi extends Api = Api> extends McpServerOptions<TApi> {
  /** Scope values for `'bound'` mode — stdio is single-tenant, so they are fixed for the process. */
  scope?: ScopeValues
  /** As whom every call runs. Default: `credentialsFromEnv(config.auth)` (e.g. the API key env var). */
  auth?: Credentials
}

/**
 * Serve over stdio in one call — the local, single-tenant twin of
 * `createMcpHandler`. Credentials come from the environment the config
 * declares, so `MYAPI_KEY=… npx myapi-mcp` just works against a remote backend.
 */
export async function serveMcpStdio<TTarget extends Target>(
  target: TTarget,
  options: McpStdioOptions<ApiOf<TTarget>> = {},
): Promise<{ close(): Promise<void> }> {
  const api: Api = isBackend(target) ? target.api : target
  const build = prepare(target, options)
  const sdk = await loadSdk()
  const { serveStdio } = await import('@modelcontextprotocol/server/stdio')
  const auth = options.auth ?? credentialsFromEnv(api.config.auth)
  return serveStdio(() => build(sdk, { ...(auth ? { auth } : {}), ...(options.scope ? { scope: options.scope } : {}) }))
}
