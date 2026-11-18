import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { OAuthClientProvider } from '@modelcontextprotocol/client'
import { CliError, ExitCode } from './commands.js'
import type { OAuthEntry } from './store.js'

/**
 * Fixed loopback ports, tried in order. RFC 8252 says an AS should accept any
 * loopback port, but CIMD authorization servers compare redirect URIs exactly
 * against the metadata document — so the document must list the ports, and
 * the CLI may only use those.
 */
export const DEFAULT_PORTS = [43110, 43111, 43112]

const redirectFor = (port: number) => `http://127.0.0.1:${port}/callback`

export interface ClientMetadataOptions {
  /** The URL this document is served at: under CIMD the URL *is* the client id. */
  clientId: string
  /** Shown on the consent screen, e.g. "Misrava CLI". */
  clientName: string
  clientUri?: string
  /** Loopback ports the CLI listens on. Must match the CLI's `oauth.ports`. */
  ports?: number[]
}

/**
 * The client metadata document a backend serves at `clientMetadataUrl` for
 * CIMD (OAuth Client ID Metadata Documents). A public native client: PKCE,
 * no secret, and exactly the loopback redirect URIs `login` can use.
 *
 *   // app/oauth/cli.json/route.ts
 *   export const GET = () => Response.json(cliClientMetadata({ clientId: 'https://misrava.app/oauth/cli.json', clientName: 'Misrava CLI' }))
 */
export function cliClientMetadata(options: ClientMetadataOptions): CliClientMetadata {
  return { client_id: options.clientId, ...clientMetadata(options) }
}

/** RFC 7591 client metadata, narrowed to what a CLI registers. */
export interface CliClientMetadata {
  client_id: string
  client_name: string
  client_uri?: string
  redirect_uris: string[]
  grant_types: string[]
  response_types: string[]
  token_endpoint_auth_method: 'none'
  application_type: 'native'
  scope?: string
}

function clientMetadata(options: {
  clientName: string
  clientUri?: string
  ports?: number[]
  scope?: string
}): Omit<CliClientMetadata, 'client_id'> {
  return {
    client_name: options.clientName,
    ...(options.clientUri ? { client_uri: options.clientUri } : {}),
    redirect_uris: (options.ports ?? DEFAULT_PORTS).map(redirectFor),
    // explicit: some authorization servers only issue refresh tokens to clients registered for them
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
    ...(options.scope ? { scope: options.scope } : {}),
  }
}

export interface OAuthOptions {
  /** The protected resource (RFC 9728) whose metadata names the authorization server. */
  resource: string
  bin: string
  clientName: string
  clientMetadataUrl?: string
  /** A pre-registered client id, for authorization servers with neither CIMD nor DCR. */
  clientId?: string
  scopes?: string[]
  ports?: number[]
  /** Called with every change, so a crash between token exchange and exit loses nothing. */
  persist: (entry: OAuthEntry) => void
}

// An optional peer: an API-key-only CLI never loads (or installs) it.
async function mcpAuth() {
  try {
    return await import('@modelcontextprotocol/client')
  } catch {
    throw new CliError(
      'OAuth needs the optional dependency @modelcontextprotocol/client. Install it: npm i @modelcontextprotocol/client',
    )
  }
}

/**
 * The MCP SDK's provider interface over one stored entry. The SDK drives
 * discovery, CIMD/DCR, PKCE and the token requests; this only decides where
 * things are kept and what "redirect the user" means.
 */
function provider(
  options: OAuthOptions,
  entry: OAuthEntry,
  redirect: { url: string; state?: string; to: (url: URL) => void },
): OAuthClientProvider {
  let verifier: string | undefined
  const save = (patch: Partial<OAuthEntry>) => {
    Object.assign(entry, patch)
    options.persist(entry)
  }
  return {
    redirectUrl: redirect.url,
    ...(options.clientMetadataUrl ? { clientMetadataUrl: options.clientMetadataUrl } : {}),
    clientMetadata: clientMetadata({ ...options, ...(options.scopes ? { scope: options.scopes.join(' ') } : {}) }),
    ...(redirect.state ? { state: () => redirect.state! } : {}),
    clientInformation: () => entry.client ?? (options.clientId ? { client_id: options.clientId } : undefined),
    saveClientInformation: (client) => save({ client }),
    tokens: () => entry.tokens,
    saveTokens: (tokens) =>
      save({ tokens, expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined }),
    redirectToAuthorization: redirect.to,
    saveCodeVerifier: (value) => void (verifier = value),
    codeVerifier: () => verifier ?? '',
    // the SDK checks the callback against the issuer it discovered, so this must outlive the redirect
    saveDiscoveryState: (discovery) => save({ discovery }),
    discoveryState: () => entry.discovery,
    invalidateCredentials: (scope) => {
      if (scope === 'all' || scope === 'tokens') save({ tokens: undefined, expiresAt: undefined })
      if (scope === 'all' || scope === 'client') save({ client: undefined })
      if (scope === 'all' || scope === 'discovery') save({ discovery: undefined })
    },
  }
}

/**
 * Exchange the refresh token for a new access token. Anything that would need
 * the browser again (no refresh token, refresh rejected) surfaces as
 * "log in again" rather than silently opening a browser mid-command.
 */
export async function refreshOAuth(options: OAuthOptions, entry: OAuthEntry): Promise<OAuthEntry> {
  const { auth } = await mcpAuth()
  const url = entry.redirectUri ?? redirectFor((options.ports ?? DEFAULT_PORTS)[0]!)
  const expired = () => {
    throw new CliError(`Your ${options.bin} session has expired. Run \`${options.bin} login\`.`, ExitCode.UNAUTHORIZED)
  }
  await auth(provider(options, entry, { url, to: expired }), { serverUrl: options.resource, ...scopeOf(options) })
  return entry
}

const scopeOf = (options: OAuthOptions) => (options.scopes?.length ? { scope: options.scopes.join(' ') } : {})

export interface LoginIo {
  log: (line: string) => void
  openBrowser: (url: string) => unknown
  /** How long to wait for the browser. */
  timeoutMs?: number
}

/**
 * Browser login, the way an MCP client does it: listen on a loopback port,
 * let the SDK discover the authorization server and build the PKCE
 * authorization URL, open it, then trade the code that comes back for tokens.
 */
export async function loginOAuth(options: OAuthOptions, previous: OAuthEntry | undefined, io: LoginIo) {
  const { auth } = await mcpAuth()
  const loopback = await listenLoopback(options.ports ?? DEFAULT_PORTS, io.timeoutMs ?? 5 * 60_000)
  try {
    // keep the client registration (no re-registering on every login); drop tokens so the SDK cannot "log in" by refreshing
    const entry: OAuthEntry = { ...(previous?.client ? { client: previous.client } : {}), redirectUri: loopback.url }
    // the SDK forwards `state` but never checks it on the way back — that is ours to do
    const state = randomBytes(16).toString('base64url')
    let authorizationUrl: URL | undefined
    const oauth = provider(options, entry, { url: loopback.url, state, to: (url) => void (authorizationUrl = url) })
    const first = await auth(oauth, { serverUrl: options.resource, ...scopeOf(options) })
    if (first === 'AUTHORIZED' || !authorizationUrl) return entry

    io.log(`Opening your browser to sign in to ${options.bin}. If it does not open, visit:\n\n  ${authorizationUrl}\n`)
    io.log('Waiting for you to finish in the browser…')
    void Promise.resolve()
      .then(() => io.openBrowser(String(authorizationUrl)))
      .catch(() => {})

    const params = await loopback.result
    const error = params.get('error')
    if (error) {
      const description = params.get('error_description')
      throw new CliError(`Sign-in failed: ${error}${description ? ` (${description})` : ''}`, ExitCode.UNAUTHORIZED)
    }
    if (params.get('state') !== state) {
      throw new CliError('Sign-in failed: the callback did not carry this login’s state. Try again.', ExitCode.ERROR)
    }
    const code = params.get('code')
    if (!code) throw new CliError('Sign-in failed: the callback carried no authorization code.', ExitCode.ERROR)
    const iss = params.get('iss')
    await auth(oauth, {
      serverUrl: options.resource,
      authorizationCode: code,
      ...(iss ? { iss } : {}),
      ...scopeOf(options),
    })
    return entry
  } finally {
    loopback.close()
  }
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto"><h1>${title}</h1><p>${body}</p></body>`

async function listenLoopback(ports: number[], timeoutMs: number) {
  let resolve!: (params: URLSearchParams) => void
  let reject!: (error: Error) => void
  const result = new Promise<URLSearchParams>((res, rej) => ((resolve = res), (reject = rej)))
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') return void res.writeHead(404).end()
    const failed = url.searchParams.has('error')
    res
      .writeHead(failed ? 400 : 200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
      .end(
        failed
          ? PAGE('Sign-in failed', 'Return to your terminal for details.')
          : PAGE('Signed in', 'You can close this tab and return to your terminal.'),
      )
    resolve(url.searchParams)
  })
  const port = await firstFreePort(server, ports)
  const timer = setTimeout(
    () => reject(new CliError('Timed out waiting for the browser sign-in.', ExitCode.UNAUTHORIZED)),
    timeoutMs,
  )
  return {
    url: redirectFor(port),
    result,
    close: () => {
      clearTimeout(timer)
      server.closeAllConnections()
      server.close()
    },
  }
}

async function firstFreePort(server: Server, ports: number[]): Promise<number> {
  for (const port of ports) {
    const bound = await new Promise<boolean>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) =>
        error.code === 'EADDRINUSE' || error.code === 'EACCES' ? resolve(false) : reject(error)
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError)
        resolve(true)
      })
    })
    if (bound) return port
  }
  throw new CliError(`Could not listen for the sign-in callback: ports ${ports.join(', ')} on 127.0.0.1 are in use.`)
}

/** Best effort and fire-and-forget: the URL is always printed too. */
export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '""', `"${url}"`]] // quoted, or cmd splits the URL at its first `&`
        : ['xdg-open', [url]]
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true })
  child.on('error', () => {})
  child.unref()
}
