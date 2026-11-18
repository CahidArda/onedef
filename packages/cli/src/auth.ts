import { credentialsFromEnv, isApiError, type Api, type Call, type Credentials, type Transport } from 'onedef'
import { CliError, ExitCode, columns } from './commands.js'
import { loginOAuth, refreshOAuth, type OAuthOptions } from './oauth.js'
import { credentialsPath } from './paths.js'
import { credentialStore, type OAuthEntry } from './store.js'
import { promptSecret, readAll, type Io } from './io.js'

export interface AuthContext {
  api: Api
  bin: string
  /** The protected resource — also the key credentials are stored under. */
  resource: string | undefined
  io: Io
  oauth?: { clientMetadataUrl?: string; clientName?: string; ports?: number[] }
}

type Resolved =
  | { source: 'env'; credentials: Credentials }
  | { source: 'apiKey'; credentials: Credentials }
  | { source: 'oauth'; credentials: Credentials; entry: OAuthEntry }

/** `sk_live_abcd…wxyz` — enough to tell keys apart, never enough to use one. */
export const mask = (secret: string) => (secret.length >= 16 ? `${secret.slice(0, 4)}…${secret.slice(-4)}` : '••••')

const until = (expiresAt: number) => {
  const minutes = Math.round((expiresAt - Date.now()) / 60_000)
  if (minutes <= 0) return 'expired'
  return minutes < 90 ? `expires in ${minutes}m` : `expires in ${Math.round(minutes / 60)}h`
}

/**
 * Everything auth for one CLI run, derived from `config.auth`: where
 * credentials come from on each call, and the `login`/`logout`/`whoami`
 * commands — which exist only when the config declares something to log in to.
 */
export function cliAuth(ctx: AuthContext) {
  const config = ctx.api.config.auth
  const { io, bin } = ctx
  const key = ctx.resource ?? bin
  const store = credentialStore(credentialsPath(bin, io.env))
  const envName = config?.apiKey?.env
  const canLogin = Boolean(config?.apiKey || config?.oauth)

  const oauthOptions = (persist: OAuthOptions['persist']): OAuthOptions => {
    if (!ctx.resource) {
      throw new CliError(
        `OAuth needs the API's resource URL: pass \`resource\` to runCli (or set \`baseUrl\` in defineConfig).`,
      )
    }
    return {
      resource: ctx.resource,
      bin,
      clientName: ctx.oauth?.clientName ?? `${bin} CLI`,
      persist,
      ...(ctx.oauth?.clientMetadataUrl ? { clientMetadataUrl: ctx.oauth.clientMetadataUrl } : {}),
      ...(config?.oauth?.clientId ? { clientId: config.oauth.clientId } : {}),
      ...(config?.oauth?.scopes ? { scopes: config.oauth.scopes } : {}),
      ...(ctx.oauth?.ports ? { ports: ctx.oauth.ports } : {}),
    }
  }
  const refresh = (entry: OAuthEntry) =>
    refreshOAuth(
      oauthOptions((next) => store.write(key, next.tokens ? { oauth: next } : undefined)),
      entry,
    )

  /** Highest first: the environment (CI, agents), a stored API key, stored OAuth tokens. */
  async function resolve(): Promise<Resolved | undefined> {
    const fromEnv = credentialsFromEnv(config, io.env)
    if (fromEnv) return { source: 'env', credentials: fromEnv }
    const stored = store.read(key)
    if (stored?.apiKey) return { source: 'apiKey', credentials: { apiKey: stored.apiKey } }
    let entry = stored?.oauth
    if (!entry?.tokens) return undefined
    // refresh a minute early: the token must still be valid when the request lands
    if (entry.expiresAt && entry.expiresAt - 60_000 < Date.now() && entry.tokens.refresh_token) {
      entry = await refresh(entry)
    }
    return { source: 'oauth', credentials: { bearer: entry.tokens!.access_token }, entry }
  }

  /**
   * Send a call as the logged-in user. Credentials ride on `call.auth`, so
   * any transport authenticates without knowing a CLI exists. An OAuth token
   * the API rejects gets one refresh and one retry — a token can be revoked
   * or rotated before its stamped expiry.
   */
  async function send(transport: Transport, call: Call): Promise<unknown> {
    const resolved = await resolve()
    const attempt = (credentials: Credentials | undefined) =>
      transport(credentials ? { ...call, auth: credentials } : call, ctx.api)
    try {
      return await attempt(resolved?.credentials)
    } catch (error) {
      if (resolved?.source !== 'oauth' || !isApiError(error) || error.code !== 'UNAUTHORIZED') throw error
      if (!resolved.entry.tokens?.refresh_token) throw error
      const entry = await refresh(resolved.entry)
      return attempt({ bearer: entry.tokens!.access_token })
    }
  }

  async function loginApiKey(fromStdin: boolean) {
    let secret: string
    if (fromStdin || !io.stdin.isTTY) secret = await readAll(io.stdin)
    else {
      if (config?.apiKey?.url) io.err(`Create an API key at ${config.apiKey.url}`)
      secret = await promptSecret(io, `Paste your ${bin} API key: `)
    }
    secret = secret.trim()
    if (!secret) throw new CliError('No API key given.', ExitCode.USAGE)
    store.write(key, { apiKey: secret })
    io.err(`Logged in to ${bin} with API key ${mask(secret)}. Stored in ${store.path}`)
    if (envName && io.env[envName]) io.err(`Note: ${envName} is set and takes precedence over the stored key.`)
  }

  async function loginWithOAuth() {
    const options = oauthOptions((entry) => entry.tokens && store.write(key, { oauth: entry }))
    const entry = await loginOAuth(options, store.read(key)?.oauth, {
      log: io.err,
      openBrowser: io.openBrowser,
    })
    io.err(`Logged in to ${bin}${entry.expiresAt ? ` (access token ${until(entry.expiresAt)})` : ''}.`)
  }

  const commands: AuthCommand[] = []
  if (canLogin) {
    const both = Boolean(config?.apiKey && config?.oauth)
    commands.push({
      name: 'login',
      summary: config?.oauth ? `Sign in to ${bin} in your browser` : `Store an API key for ${bin}`,
      flags: config?.apiKey
        ? [
            ...(both ? ([['--api-key', 'Paste an API key instead of signing in with the browser']] as const) : []),
            ['--with-token', `Read an API key from stdin, for CI: ${bin} login --with-token < key.txt`],
          ]
        : [],
      async run(flags) {
        const wantsKey = Boolean(flags['api-key'] || flags['with-token'])
        if (wantsKey && !config?.apiKey) throw new CliError(`${bin} does not accept API keys.`, ExitCode.USAGE)
        // a browser flow from a script would hang, so non-interactive runs prefer the key on stdin
        const interactive = io.stdin.isTTY && io.stdout.isTTY
        if (config?.oauth && !wantsKey && (interactive || !config.apiKey)) return loginWithOAuth()
        return loginApiKey(Boolean(flags['with-token']))
      },
    })
    commands.push({
      name: 'logout',
      summary: 'Remove stored credentials',
      flags: [],
      async run() {
        if (!store.read(key)) io.err(`Not logged in to ${bin}.`)
        else {
          store.write(key, undefined)
          io.err(`Logged out of ${bin}.`)
        }
        if (envName && io.env[envName]) io.err(`${envName} is still set in your environment.`)
      },
    })
  }
  if (config) {
    commands.push({
      name: 'whoami',
      summary: 'Show which credentials are in use',
      flags: [],
      async run() {
        const fromEnv = credentialsFromEnv(config, io.env)
        const stored = store.read(key)
        if (fromEnv?.apiKey) io.out(`API key ${mask(fromEnv.apiKey)} from ${envName}`)
        else if (fromEnv?.basic) io.out(`${fromEnv.basic.username} (basic auth from ${config.basic?.userEnv})`)
        else if (stored?.apiKey) io.out(`API key ${mask(stored.apiKey)}, stored in ${store.path}`)
        else if (stored?.oauth?.tokens) {
          const { expiresAt, tokens } = stored.oauth
          const details = [
            expiresAt ? `access token ${until(expiresAt)}` : undefined,
            tokens.refresh_token ? 'refreshes automatically' : undefined,
            tokens.scope ? `scope: ${tokens.scope}` : undefined,
          ].filter(Boolean)
          io.out(`Signed in with OAuth to ${ctx.resource}${details.length ? ` (${details.join(', ')})` : ''}`)
        } else {
          throw new CliError(`Not logged in.${hint(ctx.api, bin)}`, ExitCode.UNAUTHORIZED)
        }
      },
    })
  }

  return { resolve, send, commands }
}

export interface AuthCommand {
  name: string
  summary: string
  flags: readonly (readonly [string, string])[]
  run(flags: Record<string, string | boolean>): Promise<void>
}

/** " Run `misrava login` (or set MISRAVA_API_KEY)." — whatever the config makes possible. */
export function hint(api: Api, bin: string): string {
  const auth = api.config.auth
  const ways = [
    auth?.apiKey || auth?.oauth ? `run \`${bin} login\`` : undefined,
    auth?.apiKey?.env ? `set ${auth.apiKey.env}` : undefined,
    auth?.basic?.userEnv && auth.basic.passwordEnv
      ? `set ${auth.basic.userEnv} and ${auth.basic.passwordEnv}`
      : undefined,
  ].filter(Boolean)
  return ways.length ? ` To authenticate, ${ways.join(' or ')}.` : ''
}

export function renderAuthHelp(command: AuthCommand, bin: string): string {
  const lines = [`Usage: ${bin} ${command.name}${command.flags.length ? ' [flags]' : ''}`, '', command.summary]
  if (command.flags.length) lines.push('', 'Flags:', ...columns(command.flags.map(([flag, text]) => [flag, text])))
  return lines.join('\n')
}
