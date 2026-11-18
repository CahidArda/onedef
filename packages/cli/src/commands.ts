import {
  commandPath,
  kebab,
  scopesOf,
  toJsonSchema,
  type AnyService,
  type Api,
  type Call,
  type JsonSchema,
  type OpKind,
  type ScopeValues,
} from 'onedef'

/** Exit codes, so scripts can tell "fix your flags" from "log in" from "the API is down". */
export const ExitCode = { OK: 0, ERROR: 1, USAGE: 2, NOT_FOUND: 3, UNAUTHORIZED: 4, API: 5 } as const

/** An error that already knows its message and exit code — thrown anywhere, reported once by `runCli`. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = ExitCode.ERROR,
  ) {
    super(message)
    this.name = 'CliError'
  }
}

const usage = (message: string) => new CliError(message, ExitCode.USAGE)

export interface Flag {
  /** What the user types: `offset-ms` for `--offset-ms`. */
  name: string
  /** The input field (or scope name) the value lands in: `offsetMs`. */
  key: string
  /** `json` covers array- and object-typed inputs: the value is parsed before it is sent. */
  type: 'string' | 'number' | 'boolean' | 'json'
  description?: string
  required: boolean
  enum?: unknown[]
  default?: unknown
}

/** One CLI command per op. Plain data, so it can feed commander/citty as easily as `runCli`. */
export interface Command {
  /** `['songs', 'set-offset']`. */
  path: string[]
  /** The contract's service and op keys this command calls. */
  service: string
  op: string
  kind: OpKind
  summary: string
  description?: string
  /** Positional arguments: the member id for member ops, nothing otherwise. */
  args: { name: string; required: boolean }[]
  flags: Flag[]
  /** Scope flags (`--team`), present only on ops that declare the scope. */
  scopeFlags: Flag[]
  destructive: boolean
  /** Table columns, when the output is an array of objects. Scalar fields only: nested values make unreadable cells. */
  columns?: string[]
  /** `'cursor'`: the result is a page `{ items, nextCursor }`, printed as a table plus how to get the next page. */
  paginate?: 'cursor'
  /**
   * Turn raw argv values into a core `Call`. Flags are keyed by flag name and
   * still strings (or `true` for a bare flag): coercion by schema type happens
   * here, so any argv parser can feed it. Throws a usage `CliError`.
   */
  toCall(args: string[], flags: Record<string, string | boolean>, defaults?: { scope?: ScopeValues }): Call
}

const typeOf = (prop: JsonSchema): string | undefined =>
  prop.type ??
  ((prop.anyOf ?? prop.oneOf) as JsonSchema[] | undefined)?.map((option) => option.type).find((t) => t && t !== 'null')

const flagType = (prop: JsonSchema): Flag['type'] => {
  const type = typeOf(prop)
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'array' || type === 'object') return 'json'
  return 'string'
}

const flagsFrom = (schema: JsonSchema, skip: string | undefined): Flag[] =>
  Object.entries(schema.properties ?? {})
    .filter(([key]) => key !== skip)
    .map(([key, prop]) => ({
      name: kebab(key),
      key,
      type: flagType(prop),
      required: (schema.required ?? []).includes(key) && prop.default === undefined,
      ...(prop.description ? { description: prop.description } : {}),
      ...(Array.isArray(prop.enum) ? { enum: prop.enum } : {}),
      ...(prop.default !== undefined ? { default: prop.default } : {}),
    }))

const SCALAR = new Set(['string', 'number', 'integer', 'boolean', undefined])

const columnsOf = (schema: JsonSchema): string[] | undefined => {
  // a page ({ items, nextCursor }) tabulates its items
  if (schema.type === 'object' && schema.properties?.items && schema.properties.nextCursor)
    return columnsOf(schema.properties.items)
  if (schema.type !== 'array' || !schema.items || schema.items.type !== 'object') return undefined
  const columns = Object.entries(schema.items.properties ?? {})
    .filter(([, prop]) => SCALAR.has(typeOf(prop)))
    .map(([key]) => key)
  return columns.length ? columns : undefined
}

function coerce(flag: Flag, raw: string | boolean): unknown {
  if (flag.type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    if (/^(true|1|yes)$/i.test(raw)) return true
    if (/^(false|0|no)$/i.test(raw)) return false
    throw usage(`--${flag.name} is a boolean: pass --${flag.name} or --no-${flag.name}`)
  }
  if (raw === true) throw usage(`--${flag.name} needs a value`)
  if (raw === false) throw usage(`--no-${flag.name} only works for boolean flags`)
  if (flag.type === 'number') {
    const value = Number(raw)
    if (raw.trim() === '' || Number.isNaN(value)) throw usage(`--${flag.name} expects a number, got "${raw}"`)
    return value
  }
  if (flag.type === 'json') {
    try {
      return JSON.parse(raw)
    } catch {
      throw usage(`--${flag.name} expects JSON, e.g. --${flag.name} '["a","b"]'`)
    }
  }
  if (flag.enum && !flag.enum.includes(raw)) throw usage(`--${flag.name} must be one of: ${flag.enum.join(', ')}`)
  return raw
}

/** The value for a flag, typed either as `--offset-ms` or as the raw field name `--offsetMs`. */
const rawOf = (flags: Record<string, string | boolean>, flag: Flag) => flags[flag.name] ?? flags[flag.key]

/**
 * The command tree for a contract, as data: one command per op, named by the
 * same `commandPath` every other surface uses, flags from the op's input
 * schema. Contains no I/O, so it is as useful to a custom CLI framework as it
 * is to `runCli`.
 */
export function toCommands(api: Api): Command[] {
  return Object.entries(api.services as Record<string, AnyService>).flatMap(([service, svc]) =>
    Object.entries(svc.ops).map(([op, def]): Command => {
      const path = commandPath(svc, op, def)
      const where = path.join(' ')
      const member = def.on === 'member' ? svc.id : undefined
      const flags = flagsFrom(toJsonSchema(def.input), member)
      const scopeFlags: Flag[] = scopesOf(api, def).map((scope) => ({
        name: kebab(scope.name),
        key: scope.name,
        type: 'string',
        description: scope.description,
        required: scope.required ?? false,
      }))
      const columns = def.output ? columnsOf(toJsonSchema(def.output, 'output')) : undefined
      return {
        path,
        service,
        op,
        kind: def.kind,
        summary: def.summary,
        ...(def.description ? { description: def.description } : {}),
        args: member ? [{ name: member, required: true }] : [],
        flags,
        scopeFlags,
        destructive: def.destructive ?? false,
        ...(columns ? { columns } : {}),
        ...(def.paginate ? { paginate: def.paginate } : {}),
        toCall(args, raw, defaults = {}) {
          if (member && !args[0]) throw usage(`${where} needs <${member}>`)
          if (args.length > (member ? 1 : 0)) throw usage(`unexpected argument "${args[member ? 1 : 0]}"`)
          const input: Record<string, unknown> = member ? { [member]: args[0] } : {}
          for (const flag of flags) {
            const value = rawOf(raw, flag)
            if (value !== undefined) input[flag.key] = coerce(flag, value)
            else if (flag.required) throw usage(`${where} needs --${flag.name}`)
          }
          const scope: ScopeValues = { ...defaults.scope }
          for (const flag of scopeFlags) {
            const value = rawOf(raw, flag)
            if (value !== undefined) scope[flag.key] = coerce(flag, value) as string
            if (flag.required && !scope[flag.key]) throw usage(`${where} runs in a ${flag.key}: pass --${flag.name}`)
          }
          return { service, op, input, ...(scopeFlags.length ? { scope } : {}) }
        },
      }
    }),
  )
}

/** `songs get <slug>` — how a command is typed, for help listings. */
export const signature = (command: Command) =>
  [...command.path, ...command.args.map((arg) => `<${arg.name}>`)].join(' ')

/** Two aligned columns; the right one may be empty. */
export const columns = (rows: [string, string][], indent = '  ') => {
  const width = Math.max(0, ...rows.map(([left]) => left.length))
  return rows.map(([left, right]) => `${indent}${right ? `${left.padEnd(width)}   ${right}` : left}`.trimEnd())
}

const flagHint = (flag: Flag) => (flag.type === 'boolean' ? '' : ` <${flag.enum ? flag.enum.join('|') : flag.type}>`)

export function flagRows(flags: Flag[]): [string, string][] {
  return flags.map((flag) => [
    `--${flag.name}${flagHint(flag)}`,
    [
      flag.description,
      flag.required ? '(required)' : undefined,
      flag.default !== undefined ? `(default: ${JSON.stringify(flag.default)})` : undefined,
    ]
      .filter(Boolean)
      .join(' '),
  ])
}

/** Help for one command: usage line, prose, arguments and every flag it takes. */
export function renderCommandHelp(command: Command, bin: string): string {
  const required = [...command.scopeFlags, ...command.flags].filter((flag) => flag.required)
  const lines = [
    `Usage: ${bin} ${signature(command)}${required.map((flag) => ` --${flag.name}${flagHint(flag)}`).join('')} [flags]`,
    '',
    command.summary,
  ]
  if (command.description) lines.push('', command.description)
  if (command.destructive) lines.push('', 'This cannot be undone: pass --yes to confirm.')
  const rows = [...flagRows(command.flags), ...flagRows(command.scopeFlags), ...GLOBAL_ROWS(command)]
  if (rows.length) lines.push('', 'Flags:', ...columns(rows))
  return lines.join('\n')
}

const GLOBAL_ROWS = (command: Command): [string, string][] => [
  ...(command.destructive ? [['--yes', 'Confirm: this cannot be undone'] as [string, string]] : []),
  ...(command.columns ? [['--json', 'Print JSON instead of a table'] as [string, string]] : []),
]
