/**
 * How callers authenticate, declared once in `defineConfig({ auth })`.
 *
 * Declaring it buys every surface the same behaviour without hand-rolled
 * header code: transports render credentials onto requests (and descriptors
 * onto the upstream), hosts parse them back out of incoming headers, the CLI
 * derives `login`/`logout`/`whoami` and reads keys from the declared env var,
 * and MCP knows whether to answer 401 with OAuth discovery metadata.
 */
export interface AuthConfig {
  /**
   * An API key. Sent as `Authorization: Bearer <key>` unless `header` says
   * otherwise (e.g. `{ header: 'x-api-key', prefix: '' }`).
   */
  apiKey?: {
    header?: string
    /** Prefix before the key in the header. Default `Bearer ` for `authorization`, none otherwise. */
    prefix?: string
    /** Env var single-tenant surfaces (CLI, stdio MCP, scripts) read the key from. */
    env?: string
    /** Where a user creates a key — shown by `login` and in docs. */
    url?: string
    description?: string
  }
  /** RFC 7617 Basic: a username and a password/key. */
  basic?: { userEnv?: string; passwordEnv?: string; description?: string }
  /**
   * OAuth 2.1 bearer tokens. The authorization server is not configured here:
   * it is discovered from the backend's protected-resource metadata (RFC 9728),
   * exactly the way an MCP client finds it — so one Clerk/Auth0/WorkOS setup
   * serves the web, MCP and the CLI's `login`.
   */
  oauth?: {
    /** Scopes to request. */
    scopes?: string[]
    /** A pre-registered public client id, if the AS supports neither CIMD nor DCR. */
    clientId?: string
    /** Env var holding an access token, for CI and stdio where nobody can log in interactively. */
    env?: string
  }
}

/** One caller's credentials. */
export type Credentials =
  | { bearer: string; apiKey?: never; basic?: never }
  | { apiKey: string; bearer?: never; basic?: never }
  | { basic: { username: string; password: string }; bearer?: never; apiKey?: never }

// RFC 7617 says non-ASCII credentials are UTF-8; btoa alone throws outside
// Latin-1, so encode first. Works in browsers, workers and node.
const base64 = (value: string) => btoa(String.fromCharCode(...new TextEncoder().encode(value)))
const unbase64 = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)))

const apiKeyHeader = (auth: AuthConfig | undefined) => (auth?.apiKey?.header ?? 'authorization').toLowerCase()
const apiKeyPrefix = (auth: AuthConfig | undefined) =>
  auth?.apiKey?.prefix ?? (apiKeyHeader(auth) === 'authorization' ? 'Bearer ' : '')

/** Credentials as request headers — the exact inverse of `credentialsFromHeaders`. */
export function credentialHeaders(
  auth: AuthConfig | undefined,
  credentials: Credentials | undefined,
): Record<string, string> {
  if (!credentials) return {}
  if (credentials.basic) {
    return { authorization: `Basic ${base64(`${credentials.basic.username}:${credentials.basic.password}`)}` }
  }
  if (credentials.apiKey !== undefined) return { [apiKeyHeader(auth)]: `${apiKeyPrefix(auth)}${credentials.apiKey}` }
  return { authorization: `Bearer ${credentials.bearer}` }
}

/**
 * Parse incoming credentials against the declared schemes. A Bearer token
 * that the config could read as either an API key or an OAuth token comes
 * back as `bearer` — telling them apart is the verifier's job, not the parser's.
 */
export function credentialsFromHeaders(auth: AuthConfig | undefined, headers: Headers): Credentials | undefined {
  const header = apiKeyHeader(auth)
  if (auth?.apiKey && header !== 'authorization') {
    const raw = headers.get(header)
    const prefix = apiKeyPrefix(auth)
    if (raw && raw.startsWith(prefix)) return { apiKey: raw.slice(prefix.length) }
  }
  const authorization = headers.get('authorization') ?? ''
  if (/^Bearer /i.test(authorization)) return { bearer: authorization.slice(7).trim() }
  if (auth?.basic && /^Basic /i.test(authorization)) {
    const decoded = unbase64(authorization.slice(6).trim())
    const separator = decoded.indexOf(':')
    if (separator !== -1)
      return { basic: { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) } }
  }
  return undefined
}

/** Env intake for single-tenant surfaces, using the names declared in the config. */
export function credentialsFromEnv(
  auth: AuthConfig | undefined,
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env,
): Credentials | undefined {
  const read = (name: string | undefined) => (name ? env[name]?.trim() || undefined : undefined)
  const user = read(auth?.basic?.userEnv)
  const password = read(auth?.basic?.passwordEnv)
  if (user && password) return { basic: { username: user, password } }
  const key = read(auth?.apiKey?.env)
  if (key) return { apiKey: key }
  const token = read(auth?.oauth?.env)
  if (token) return { bearer: token }
  return undefined
}
