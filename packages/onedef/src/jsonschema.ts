import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Schema } from './contract.js'

export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema & { description?: string }>
  required?: string[]
  items?: JsonSchema
  description?: string
  enum?: unknown[]
  default?: unknown
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  [k: string]: unknown
}

/**
 * Standard Schema carries no JSON Schema of its own, so vendors expose their own
 * converter. Register one here and every generator (OpenAPI, MCP, CLI, docs) gets it.
 */
let converter: ((schema: Schema) => JsonSchema) | undefined

export function registerJsonSchemaConverter(fn: (schema: Schema) => JsonSchema): void {
  converter = fn
}

const OMIT = Symbol.for('onedef.omit')
const PATHKEYS = Symbol.for('onedef.pathKeys')

interface Omitted {
  [OMIT]: { schema: Schema; keys: string[] }
}
interface WithKeys {
  [PATHKEYS]: { schema: Schema | undefined; keys: string[] }
}

const validateWith = (schema: Schema, value: unknown) => schema['~standard'].validate(value)

/**
 * Combinators must be real Standard Schemas, not inert markers: oRPC validates
 * `.output()` at runtime, so a marker object would pass JSON Schema generation
 * and then fail every request.
 */
function standard<TOutput>(
  validate: StandardSchemaV1.Props<unknown, TOutput>['validate'],
): StandardSchemaV1<unknown, TOutput> {
  return { '~standard': { version: 1, vendor: 'onedef', validate } }
}

/**
 * Widen an operation's input schema with the keys that address the resource.
 *
 * A mutation declares only its payload (`{ name }`), but the route addresses the
 * resource by id (`/redis/{database_id}/rename`). Validators strip undeclared
 * keys, so without this the id never reaches the handler and every id-addressed
 * mutation silently receives `undefined`.
 *
 * Used to describe a member op's input (id + payload) to transports and
 * schema generators that see the id as part of the input.
 */
export function withPathKeys(schema: Schema | undefined, keys: string[]): Schema {
  const self = standard(async (value) => {
    const v = (value ?? {}) as Record<string, unknown>
    const picked: Record<string, unknown> = {}
    for (const k of keys) {
      if (typeof v[k] !== 'string' || v[k] === '')
        return { issues: [{ message: `Expected a string "${k}"`, path: [k] }] }
      picked[k] = v[k]
    }
    if (!schema) return { value: picked }
    const r = await validateWith(schema, v)
    if (r.issues) return r
    return { value: { ...(r.value as object), ...picked } }
  })
  return Object.assign(self, { [PATHKEYS]: { schema, keys } }) as unknown as Schema
}

/** Remove `keys` from an object, or from each object of an array. */
export function stripKeys<TValue>(value: TValue, keys: readonly string[]): TValue {
  if (!keys.length || value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => stripKeys(item, keys)) as TValue
  const copy = { ...(value as Record<string, unknown>) }
  for (const key of keys) delete copy[key]
  return copy as TValue
}

/** Drop fields from a schema — from its JSON Schema *and* from validated values. */
export function omitFrom<TSchema extends Schema | undefined>(schema: TSchema, keys: string[]): TSchema {
  if (!schema || !keys.length) return schema
  const self = standard(async (value) => {
    const r = await validateWith(schema, value)
    if (r.issues) return r
    return { value: stripKeys(r.value, keys) }
  })
  return Object.assign(self, { [OMIT]: { schema, keys } }) as unknown as TSchema
}

/**
 * JSON Schema for any Standard Schema. Validators that implement Standard JSON
 * Schema (zod ≥ 4.2, arktype, valibot) need nothing registered; anything else
 * goes through `registerJsonSchemaConverter`. `io` picks the input or output
 * view — they differ for transforms and defaults.
 */
export function toJsonSchema(schema: Schema | undefined, io: 'input' | 'output' = 'input'): JsonSchema {
  if (!schema) return { type: 'object', properties: {} }
  const pathKeys = (schema as Partial<WithKeys>)[PATHKEYS]
  if (pathKeys) {
    const inner = pathKeys.schema ? toJsonSchema(pathKeys.schema, io) : { type: 'object', properties: {} }
    return {
      ...inner,
      type: 'object',
      properties: {
        ...(inner.properties ?? {}),
        ...Object.fromEntries(pathKeys.keys.map((key) => [key, { type: 'string' }])),
      },
      required: [...new Set([...(inner.required ?? []), ...pathKeys.keys])],
    }
  }
  const omitted = (schema as Partial<Omitted>)[OMIT]
  if (omitted) {
    const inner = toJsonSchema(omitted.schema, io)
    const strip = (js: JsonSchema): JsonSchema => {
      if (js.type === 'array' && js.items) return { ...js, items: strip(js.items) }
      const properties = { ...(js.properties ?? {}) }
      for (const key of omitted.keys) delete properties[key]
      return { ...js, properties, required: (js.required ?? []).filter((name) => !omitted.keys.includes(name)) }
    }
    return strip(inner)
  }
  const standardJson = (
    schema['~standard'] as { jsonSchema?: Record<typeof io, (o: { target: string }) => JsonSchema> }
  ).jsonSchema
  if (standardJson) {
    const { $schema: _drop, ...rest } = standardJson[io]({ target: 'draft-2020-12' })
    return rest
  }
  if (!converter) {
    throw new Error(
      'onedef: this schema has no Standard JSON Schema support. Use a validator that has it (zod ≥ 4.2, ' +
        "arktype, valibot) or call registerJsonSchemaConverter() with your validator's converter.",
    )
  }
  return converter(schema)
}
