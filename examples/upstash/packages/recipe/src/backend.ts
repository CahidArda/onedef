import { Redis } from '@upstash/redis'
import { credentialsFromEnv, fail, implement } from 'onedef'
import { config, contract } from './contract.js'

/**
 * Server only (it pulls in @upstash/redis). Mixing the two modes: `query` is
 * the one op with code; every op with an `http` descriptor has no handler, so
 * the backend proxies it to api.upstash.com.
 *
 * Upstream credentials are the caller's own (Basic from the CLI, the SDK, an
 * MCP client's Authorization header); a caller that sends none, like the web
 * console, falls back to the server's UPSTASH_EMAIL/UPSTASH_API_KEY.
 */
export const backend = implement(
  contract,
  {
    redis: {
      query: async ({ id, input, client }) => {
        // through the same backend: proxied to /v2/redis/database/{id} as the same caller
        const db = await client.redis.get({ database_id: id })
        if (!db.endpoint || !db.rest_token) fail('UNPROCESSABLE', `Database ${id} has no REST endpoint or token`)
        // real endpoints are schemeless hostnames; an explicit scheme (a local stub) is kept
        const url = db.endpoint.startsWith('http') ? db.endpoint : `https://${db.endpoint}`
        const redis = new Redis({ url, token: db.rest_token })
        return { result: await redis.exec(input.command as [string, ...(string | number)[]]) }
      },
    },
  },
  {
    upstream: {
      baseUrl: process.env.UPSTASH_API_URL ?? config.baseUrl,
      auth: () => credentialsFromEnv(config.auth),
    },
  },
)
