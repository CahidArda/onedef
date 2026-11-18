import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { z } from 'zod'
import { ApiError, defineApi, defineConfig, defineService, http, query, type Credentials, type Transport } from 'onedef'
import { cliClientMetadata, toSkillMarkdown } from '../src/index.js'
import { run, tempConfig } from './helpers.js'

const config = defineConfig({
  name: 'misrava',
  auth: {
    apiKey: { env: 'MISRAVA_API_KEY', url: 'https://misrava.app/settings/keys' },
    oauth: { scopes: ['songs:read'] },
  },
})
const account = defineService(config, {
  name: 'account',
  description: 'Who you are.',
  ops: {
    me: query({
      summary: 'Show the current user',
      output: z.object({ user: z.string() }),
      http: { method: 'GET', path: '/me' },
    }),
  },
})
const contract = defineApi(config, { account })

const KEY = 'sk_live_1234567890abcdef'

/** A transport that answers everything and remembers the credentials each call carried. */
function recorder() {
  const seen: (Credentials | undefined)[] = []
  const transport: Transport = async (call) => {
    seen.push(call.auth)
    return { user: 'ada' }
  }
  return { seen, transport }
}

test('the env API key reaches the transport as call.auth', async () => {
  const { seen, transport } = recorder()
  const result = await run(contract, ['account', 'me'], {
    transport,
    env: { MISRAVA_API_KEY: KEY, ...tempConfig('misrava') },
  })
  assert.equal(result.code, 0, result.stderr)
  assert.deepEqual(seen, [{ apiKey: KEY }])
})

test('login --with-token stores the key (0600), calls use it, whoami masks it, logout removes it', async () => {
  const env = tempConfig('misrava')
  const file = join(env.MISRAVA_CONFIG_DIR!, 'credentials.json')
  const { seen, transport } = recorder()
  const options = { transport, env, resource: 'https://misrava.app/api' }

  const login = await run(contract, ['login', '--with-token'], { ...options, stdin: `${KEY}\n` })
  assert.equal(login.code, 0, login.stderr)
  assert.match(login.stderr, /Logged in to misrava with API key sk_l…cdef/)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.equal(statSync(env.MISRAVA_CONFIG_DIR!).mode & 0o777, 0o700)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).resources, { 'https://misrava.app/api': { apiKey: KEY } })

  await run(contract, ['account', 'me'], options)
  assert.deepEqual(seen.at(-1), { apiKey: KEY })
  // the environment still wins over a stored key
  await run(contract, ['account', 'me'], { ...options, env: { ...env, MISRAVA_API_KEY: 'sk_from_env' } })
  assert.deepEqual(seen.at(-1), { apiKey: 'sk_from_env' })

  const whoami = await run(contract, ['whoami'], options)
  assert.equal(whoami.code, 0)
  assert.match(whoami.stdout, /^API key sk_l…cdef, stored in /)
  assert.ok(!whoami.stdout.includes(KEY))

  const logout = await run(contract, ['logout'], options)
  assert.equal(logout.code, 0)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).resources, {})
  await run(contract, ['account', 'me'], options)
  assert.equal(seen.at(-1), undefined)

  const anon = await run(contract, ['whoami'], options)
  assert.equal(anon.code, 4)
  assert.match(anon.stderr, /Not logged in\. To authenticate, run `misrava login` or set MISRAVA_API_KEY\./)
})

test('non-interactive `login` reads the key from stdin even when OAuth is declared', async () => {
  const env = tempConfig('misrava')
  const { seen, transport } = recorder()
  assert.equal((await run(contract, ['login'], { transport, env, stdin: KEY })).code, 0)
  await run(contract, ['account', 'me'], { transport, env })
  assert.deepEqual(seen, [{ apiKey: KEY }])
})

test('UNAUTHORIZED exits 4 with a login hint; help lists the auth commands', async () => {
  const transport: Transport = async () => {
    throw new ApiError('UNAUTHORIZED', 'GET /me → 401')
  }
  const result = await run(contract, ['account', 'me'], { transport, env: tempConfig('misrava') })
  assert.equal(result.code, 4)
  assert.equal(result.stderr, 'error: GET /me → 401\nTo authenticate, run `misrava login` or set MISRAVA_API_KEY.\n')

  const help = await run(contract, ['--help'], { transport })
  assert.match(help.stdout, /Authentication:\n {2}login\s+Sign in to misrava in your browser\n {2}logout/)
  const loginHelp = await run(contract, ['login', '--help'], { transport })
  assert.match(loginHelp.stdout, /--api-key\s+Paste an API key/)
  assert.match(loginHelp.stdout, /--with-token\s+Read an API key from stdin/)

  const skill = toSkillMarkdown(contract, { bin: 'misrava', description: 'Lessons.' })
  assert.match(skill, /set `MISRAVA_API_KEY`/)
  assert.match(skill, /misrava login --with-token/)
})

// ---------------------------------------------------------------------------
// OAuth against a mock authorization server + protected resource.

const readBody = async (req: IncomingMessage) => {
  let body = ''
  for await (const chunk of req) body += chunk
  return body
}
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

async function mockOAuth(options: { cimd?: boolean; expiresIn?: number } = {}) {
  const state = {
    registrations: [] as Record<string, unknown>[],
    authorizeClientIds: [] as string[],
    grants: [] as string[],
    valid: new Set<string>(),
    refresh: new Set<string>(),
    issued: 0,
  }
  const codes = new Map<string, { challenge: string; clientId: string }>()
  const issue = () => {
    const n = ++state.issued
    state.valid.add(`at-${n}`)
    state.refresh.add(`rt-${n}`)
    return {
      access_token: `at-${n}`,
      refresh_token: `rt-${n}`,
      token_type: 'Bearer',
      expires_in: options.expiresIn ?? 3600,
    }
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, origin)
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
      res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body))
    const body = await readBody(req)
    switch (url.pathname) {
      case '/.well-known/oauth-protected-resource/api':
        return json(200, {
          resource: `${origin}/api`,
          authorization_servers: [origin],
          scopes_supported: ['songs:read'],
        })
      case '/.well-known/oauth-authorization-server':
        return json(200, {
          issuer: origin,
          authorization_endpoint: `${origin}/authorize`,
          token_endpoint: `${origin}/token`,
          registration_endpoint: `${origin}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
          ...(options.cimd ? { client_id_metadata_document_supported: true } : {}),
        })
      case '/register': {
        const metadata = JSON.parse(body)
        state.registrations.push(metadata)
        return json(201, { ...metadata, client_id: 'dcr-client' })
      }
      case '/authorize': {
        const clientId = url.searchParams.get('client_id')!
        state.authorizeClientIds.push(clientId)
        const code = randomUUID()
        codes.set(code, { challenge: url.searchParams.get('code_challenge')!, clientId })
        const back = new URL(url.searchParams.get('redirect_uri')!)
        back.searchParams.set('code', code)
        back.searchParams.set('state', url.searchParams.get('state')!)
        return res.writeHead(302, { location: String(back) }).end()
      }
      case '/token': {
        const form = new URLSearchParams(body)
        state.grants.push(form.get('grant_type')!)
        if (form.get('grant_type') === 'authorization_code') {
          const grant = codes.get(form.get('code')!)
          if (
            !grant ||
            s256(form.get('code_verifier')!) !== grant.challenge ||
            grant.clientId !== form.get('client_id')
          ) {
            return json(400, { error: 'invalid_grant' })
          }
          codes.delete(form.get('code')!)
          return json(200, issue())
        }
        if (form.get('grant_type') === 'refresh_token' && state.refresh.delete(form.get('refresh_token')!)) {
          return json(200, issue())
        }
        return json(400, { error: 'invalid_grant' })
      }
      case '/api/me': {
        const token = req.headers.authorization?.replace(/^Bearer /, '')
        if (token && state.valid.has(token)) return json(200, { user: `ada (${token})` })
        return json(
          401,
          { error: 'invalid_token' },
          {
            'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api"`,
          },
        )
      }
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { origin, state, close: () => server.close() }
}

/** The "browser": follow the authorization URL, then deliver its redirect to the loopback server. */
const browser = async (url: string) => {
  const res = await fetch(url, { redirect: 'manual' })
  await fetch(res.headers.get('location')!)
}

async function oauthSetup(options: Parameters<typeof mockOAuth>[0] = {}) {
  const as = await mockOAuth(options)
  const env = tempConfig('misrava')
  const file = join(env.MISRAVA_CONFIG_DIR!, 'credentials.json')
  const base = {
    transport: http({ baseUrl: `${as.origin}/api` }),
    resource: `${as.origin}/api`,
    env,
    oauth: { ports: [47391, 47392] },
  }
  const stored = () => JSON.parse(readFileSync(file, 'utf8')).resources[`${as.origin}/api`]
  return { as, env, file, base, stored }
}

test('OAuth login via DCR: browser round trip, tokens stored, calls carry the bearer', async (t) => {
  const { as, base, file, stored } = await oauthSetup()
  t.after(as.close)

  let opened = ''
  const login = await run(contract, ['login'], {
    ...base,
    tty: true,
    openBrowser: (url) => ((opened = url), browser(url)),
  })
  assert.equal(login.code, 0, login.stderr)
  assert.ok(opened.startsWith(`${as.origin}/authorize?`))
  assert.ok(login.stderr.includes(opened), 'the URL is printed too')
  assert.match(login.stderr, /Logged in to misrava \(access token expires in 60m\)/)

  // DCR: one registration, with exactly the loopback redirect URIs and the declared scope
  assert.equal(as.state.registrations.length, 1)
  assert.deepEqual(as.state.registrations[0]!.redirect_uris, [
    'http://127.0.0.1:47391/callback',
    'http://127.0.0.1:47392/callback',
  ])
  assert.deepEqual(as.state.registrations[0]!.grant_types, ['authorization_code', 'refresh_token'])
  assert.equal(as.state.registrations[0]!.token_endpoint_auth_method, 'none')
  assert.deepEqual(as.state.authorizeClientIds, ['dcr-client'])
  assert.equal(new URL(opened).searchParams.get('scope'), 'songs:read')

  const entry = stored()
  assert.equal(entry.oauth.tokens.access_token, 'at-1')
  assert.ok(entry.oauth.expiresAt > Date.now() + 3500_000)
  assert.equal(statSync(file).mode & 0o777, 0o600)

  const me = await run(contract, ['account', 'me'], base)
  assert.equal(me.code, 0, me.stderr)
  assert.deepEqual(JSON.parse(me.stdout), { user: 'ada (at-1)' })

  const whoami = await run(contract, ['whoami'], base)
  assert.match(
    whoami.stdout,
    /^Signed in with OAuth to .*\/api \(access token expires in 60m, refreshes automatically\)/,
  )
  assert.ok(!whoami.stdout.includes('at-1') && !whoami.stdout.includes('rt-1'))
})

test('OAuth: an expiring token is refreshed before the call; a rejected one is refreshed and retried', async (t) => {
  const { as, base, file, stored } = await oauthSetup()
  t.after(as.close)
  assert.equal((await run(contract, ['login'], { ...base, tty: true, openBrowser: browser })).code, 0)

  // within the 60s skew → refreshed proactively
  const data = JSON.parse(readFileSync(file, 'utf8'))
  data.resources[`${as.origin}/api`].oauth.expiresAt = Date.now() + 30_000
  writeFileSync(file, JSON.stringify(data))
  const proactive = await run(contract, ['account', 'me'], base)
  assert.deepEqual(JSON.parse(proactive.stdout), { user: 'ada (at-2)' })
  assert.equal(stored().oauth.tokens.access_token, 'at-2')
  assert.deepEqual(as.state.grants, ['authorization_code', 'refresh_token'])

  // revoked before its expiry → 401 → one refresh → retry succeeds
  as.state.valid.delete('at-2')
  const retried = await run(contract, ['account', 'me'], base)
  assert.equal(retried.code, 0, retried.stderr)
  assert.deepEqual(JSON.parse(retried.stdout), { user: 'ada (at-3)' })

  // refresh token revoked as well → "log in again", exit 4, tokens dropped
  as.state.valid.delete('at-3')
  as.state.refresh.clear()
  const expired = await run(contract, ['account', 'me'], base)
  assert.equal(expired.code, 4)
  assert.match(expired.stderr, /session has expired\. Run `misrava login`/)
  assert.equal(stored(), undefined)
})

test('OAuth login uses CIMD when the AS supports it and clientMetadataUrl is set', async (t) => {
  const { as, base, stored } = await oauthSetup({ cimd: true })
  t.after(as.close)
  const clientMetadataUrl = 'https://misrava.app/oauth/cli.json'
  const login = await run(contract, ['login'], {
    ...base,
    oauth: { ...base.oauth, clientMetadataUrl },
    tty: true,
    openBrowser: browser,
  })
  assert.equal(login.code, 0, login.stderr)
  assert.equal(as.state.registrations.length, 0)
  assert.deepEqual(as.state.authorizeClientIds, [clientMetadataUrl])
  assert.equal(stored().oauth.client.client_id, clientMetadataUrl)

  // the document that URL must serve lists the same redirect URIs login used
  assert.deepEqual(
    cliClientMetadata({ clientId: clientMetadataUrl, clientName: 'Misrava CLI', ports: [47391, 47392] }),
    {
      client_id: clientMetadataUrl,
      client_name: 'Misrava CLI',
      redirect_uris: ['http://127.0.0.1:47391/callback', 'http://127.0.0.1:47392/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      application_type: 'native',
    },
  )
})

test('OAuth login rejects a callback whose state does not match', async (t) => {
  const { as, base } = await oauthSetup()
  t.after(as.close)
  const forged = async (url: string) => {
    const res = await fetch(url, { redirect: 'manual' })
    const back = new URL(res.headers.get('location')!)
    back.searchParams.set('state', 'forged')
    await fetch(back)
  }
  const login = await run(contract, ['login'], { ...base, tty: true, openBrowser: forged })
  assert.equal(login.code, 1)
  assert.match(login.stderr, /did not carry this login’s state/)
  assert.deepEqual(as.state.grants, [])
})
