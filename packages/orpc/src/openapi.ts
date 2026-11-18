import { OpenAPIGenerator, type ConditionalSchemaConverter } from '@orpc/openapi'
import { toJsonSchema, type Api, type Schema } from 'onedef'
import { toRouter } from './router.js'

export interface OpenApiOptions {
  /** Path prefix the API is served under. Default `/api`, matching `toFetchHandler`. */
  prefix?: string
  /** Default: `config.name`. */
  title?: string
  /** Default: `config.version`, else `0.0.0`. */
  version?: string
  /** Default: `config.description`. */
  description?: string
  servers?: { url: string; description?: string }[]
}

/** Core's `toJsonSchema` understands every validator and combinator a contract can hold. */
const converter: ConditionalSchemaConverter = {
  condition: (schema) => schema !== undefined,
  convert: (schema, { strategy }) => [true, toJsonSchema(schema as Schema, strategy) as never],
}

type SecurityScheme = Record<string, string>

/**
 * Security schemes from `config.auth`. OAuth is described as plain bearer on
 * purpose: its authorization server is discovered at runtime (RFC 9728), so
 * there are no fixed URLs to write into an `oauth2` flow.
 */
function securitySchemes(api: Api): Record<string, SecurityScheme> {
  const auth = api.config.auth
  const schemes: Record<string, SecurityScheme> = {}
  if (auth?.apiKey) {
    const header = auth.apiKey.header ?? 'authorization'
    const prefix = auth.apiKey.prefix ?? (header.toLowerCase() === 'authorization' ? 'Bearer ' : '')
    const description = auth.apiKey.description ?? (auth.apiKey.url ? `Create a key at ${auth.apiKey.url}.` : undefined)
    schemes.apiKey = {
      ...(header.toLowerCase() === 'authorization' && prefix === 'Bearer '
        ? { type: 'http', scheme: 'bearer' }
        : { type: 'apiKey', in: 'header', name: header }),
      ...(description ? { description } : {}),
    }
  }
  if (auth?.basic) {
    schemes.basic = {
      type: 'http',
      scheme: 'basic',
      ...(auth.basic.description ? { description: auth.basic.description } : {}),
    }
  }
  if (auth?.oauth) {
    schemes.oauth = {
      type: 'http',
      scheme: 'bearer',
      description:
        'OAuth 2.1 access token. The authorization server is discovered from the protected-resource metadata (RFC 9728).',
    }
  }
  return schemes
}

/**
 * The OpenAPI document for a contract — no handlers needed, so docs and SDK
 * generators can run at build time. It comes from the same router
 * `toFetchHandler` serves, so paths, scope headers, error responses and
 * `x-destructive` cannot drift from the running API.
 */
export async function generateOpenApi(api: Api, options: OpenApiOptions = {}): Promise<Record<string, unknown>> {
  const neverRuns = {
    api,
    handle: () => Promise.reject(new Error('onedef: generateOpenApi never runs handlers')),
  }
  const router = toRouter(neverRuns, { prefix: options.prefix ?? '/api' })
  const schemes = securitySchemes(api)
  const description = options.description ?? api.config.description
  const doc = await new OpenAPIGenerator({ schemaConverters: [converter] }).generate(router, {
    info: {
      title: options.title ?? api.config.name,
      version: options.version ?? api.config.version ?? '0.0.0',
      ...(description ? { description } : {}),
    },
    ...(options.servers ? { servers: options.servers } : {}),
    ...(Object.keys(schemes).length
      ? {
          components: { securitySchemes: schemes },
          // alternatives: any one declared scheme authenticates a call
          security: Object.keys(schemes).map((name) => ({ [name]: [] })),
        }
      : {}),
    tags: Object.values(api.services).map((svc) => ({ name: svc.name, description: svc.description })),
  } as never)
  return doc as unknown as Record<string, unknown>
}
