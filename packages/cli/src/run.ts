import { isApiError, type Api, type ScopeValues, type Transport } from 'onedef'
import { cliAuth, hint, renderAuthHelp, type AuthCommand } from './auth.js'
import { CliError, ExitCode, columns, renderCommandHelp, signature, toCommands, type Command } from './commands.js'
import { confirm, resolveIo, type CliIo, type Io } from './io.js'

export interface RunCliOptions {
  /** Who answers calls: `rpc({ url })`, `http()`, `local(backend)` — any core transport. */
  transport: Transport
  /** Binary name for help and the config directory. Default: `config.name`. */
  bin?: string
  /**
   * The OAuth protected resource (RFC 9728) `login` discovers the authorization
   * server from, and the key stored credentials live under. Default: `config.baseUrl`.
   */
  resource?: string
  /** Ambient scope defaults (e.g. from env); `--team` and friends override them. */
  scope?: () => ScopeValues | undefined
  /** Default: `process.argv.slice(2)`. */
  argv?: string[]
  oauth?: {
    /**
     * A CIMD client id: an https URL serving `cliClientMetadata(...)`. Used when
     * the authorization server advertises CIMD support; otherwise login falls
     * back to dynamic client registration.
     */
    clientMetadataUrl?: string
    /** Shown on the consent screen of DCR registrations. Default: `<bin> CLI`. */
    clientName?: string
    /** Loopback ports to try; must match the CIMD document's redirect URIs. */
    ports?: number[]
  }
  /**
   * Replace stdout/stderr/stdin/env/the browser. When given, `runCli` leaves
   * `process.exitCode` alone and only returns the code — for tests and embedding.
   */
  io?: CliIo
}

const GLOBAL_BOOLEANS = new Set(['help', 'json', 'yes', 'api-key', 'with-token'])

function parseArgv(argv: string[], isBoolean: (name: string) => boolean) {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1))
      break
    }
    if (arg === '-h') flags.help = true
    else if (arg.startsWith('--')) {
      const body = arg.slice(2)
      const eq = body.indexOf('=')
      if (eq !== -1) flags[body.slice(0, eq)] = body.slice(eq + 1)
      else if (body.startsWith('no-') && isBoolean(body.slice(3))) flags[body.slice(3)] = false
      else if (isBoolean(body)) flags[body] = true
      else {
        const next = argv[i + 1]
        flags[body] = next === undefined || next.startsWith('--') ? true : (i++, next)
      }
    } else positionals.push(arg)
  }
  return { positionals, flags }
}

function renderRootHelp(api: Api, bin: string, commands: Command[], auth: AuthCommand[]): string {
  const lines = [`Usage: ${bin} <command> [args] [flags]`]
  if (api.config.description) lines.push('', api.config.description)
  lines.push('', 'Commands:', ...columns(commands.map((command) => [signature(command), command.summary])))
  if (auth.length) {
    lines.push('', 'Authentication:', ...columns(auth.map((command) => [command.name, command.summary])))
    const how = hint(api, bin).trim()
    if (how) lines.push('', how)
  }
  lines.push('', `Run \`${bin} <command> --help\` for its flags. Add --json to any command for JSON output.`)
  return lines.join('\n')
}

function renderServiceHelp(api: Api, bin: string, service: string, commands: Command[]): string {
  const svc = api.services[service]
  return [
    `Usage: ${bin} ${commands[0]!.path[0]} <command> [args] [flags]`,
    ...(svc?.description ? ['', svc.description] : []),
    '',
    'Commands:',
    ...columns(commands.map((command) => [signature(command), command.summary])),
  ].join('\n')
}

function render(io: Io, command: Command, result: unknown, json: boolean, argv: string[] = []) {
  if (result === undefined) return
  if (!json && command.paginate && result && typeof result === 'object' && 'items' in result) {
    const page = result as { items: unknown; nextCursor?: string }
    render(io, command, page.items, json)
    // on stderr, so piping the table stays clean
    if (page.nextCursor) {
      const rest = argv.filter(
        (arg, i) => arg !== '--cursor' && argv[i - 1] !== '--cursor' && !arg.startsWith('--cursor='),
      )
      io.err(`\nMore: ${[...rest, '--cursor', page.nextCursor].join(' ')}`)
    }
    return
  }
  if (!json && command.columns && Array.isArray(result)) {
    if (!result.length) return io.err('(no results)')
    const cell = (value: unknown) =>
      value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
    const rows = [
      command.columns.map((column) => column.toUpperCase()),
      ...result.map((row) => command.columns!.map((column) => cell((row as Record<string, unknown>)[column]))),
    ]
    const widths = command.columns.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)))
    const line = (row: string[]) => row.map((value, i) => value.padEnd(widths[i]!)).join('  ')
    for (const row of rows) io.out(line(row).trimEnd())
    return
  }
  io.out(typeof result === 'string' && !json ? result : JSON.stringify(result, null, 2))
}

/** API error codes → exit codes. Anything the API reports that is not about the caller's input or auth is its fault (5). */
function exitCodeOf(code: string): number {
  if (code === 'NOT_FOUND') return ExitCode.NOT_FOUND
  if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN') return ExitCode.UNAUTHORIZED
  if (code === 'INVALID_INPUT' || code === 'BAD_REQUEST') return ExitCode.USAGE
  return ExitCode.API
}

/**
 * A complete CLI for a contract. The whole program is usually:
 *
 *   #!/usr/bin/env node
 *   import { runCli } from '@onedef/cli'
 *   import { rpc } from '@onedef/orpc/client'
 *   import { contract } from './contract'
 *   await runCli(contract, { transport: rpc({ url: 'https://acme.dev/api' }) })
 *
 * Commands, flags, help, tables, the `--yes` guard and `login`/`logout`/`whoami`
 * all come from the contract. Resolves to the exit code: 0 ok · 1 error ·
 * 2 usage · 3 not found · 4 unauthorized · 5 API error.
 */
export async function runCli(api: Api<any, any>, options: RunCliOptions): Promise<number> {
  const io = resolveIo(options.io)
  const bin = options.bin ?? api.config.name
  const resource = options.resource ?? api.config.baseUrl
  let code: number
  try {
    code = await main(api, options, io, bin, resource)
  } catch (error) {
    code = report(api, io, bin, error)
  }
  if (!options.io) process.exitCode = code
  return code
}

async function main(api: Api, options: RunCliOptions, io: Io, bin: string, resource: string | undefined) {
  const argv = options.argv ?? process.argv.slice(2)
  const commands = toCommands(api)
  const auth = cliAuth({ api, bin, resource, io, ...(options.oauth ? { oauth: options.oauth } : {}) })
  const { positionals, flags } = parseArgv(argv, (name) => GLOBAL_BOOLEANS.has(name))
  const [first, second] = positionals

  if (!first) {
    io.out(renderRootHelp(api, bin, commands, auth.commands))
    return ExitCode.OK
  }
  const authCommand = auth.commands.find((command) => command.name === first)
  if (authCommand) {
    if (flags.help) io.out(renderAuthHelp(authCommand, bin))
    else await authCommand.run(flags)
    return ExitCode.OK
  }
  const group = commands.filter((command) => command.path[0] === first)
  if (!group.length) throw new CliError(`unknown command "${first}". Run \`${bin} --help\`.`, ExitCode.USAGE)
  const command = group.find((candidate) => candidate.path[1] === second)
  if (!command) {
    if (second && !flags.help) {
      throw new CliError(`unknown command "${first} ${second}". Run \`${bin} ${first} --help\`.`, ExitCode.USAGE)
    }
    io.out(renderServiceHelp(api, bin, group[0]!.service, group))
    return ExitCode.OK
  }

  // second pass, now that the command's boolean flags are known: `--force songs` must not eat a word
  const all = [...command.flags, ...command.scopeFlags]
  const booleans = new Set(all.filter((flag) => flag.type === 'boolean').flatMap((flag) => [flag.name, flag.key]))
  const parsed = parseArgv(argv, (name) => GLOBAL_BOOLEANS.has(name) || booleans.has(name))
  if (parsed.flags.help) {
    io.out(renderCommandHelp(command, bin))
    return ExitCode.OK
  }
  const known = new Set([...GLOBAL_BOOLEANS, ...all.flatMap((flag) => [flag.name, flag.key])])
  const unknown = Object.keys(parsed.flags).find((name) => !known.has(name))
  if (unknown) {
    throw new CliError(`unknown flag --${unknown}. Run \`${bin} ${command.path.join(' ')} --help\`.`, ExitCode.USAGE)
  }

  const scope = options.scope?.()
  const call = command.toCall(parsed.positionals.slice(command.path.length), parsed.flags, scope ? { scope } : {})
  if (command.destructive && !parsed.flags.yes) {
    const what = [...command.path, ...command.args.map((arg) => String(call.input[arg.name]))].join(' ')
    const interactive = io.stdin.isTTY && io.stdout.isTTY
    if (!interactive || !(await confirm(io, `\`${what}\` cannot be undone. Continue?`))) {
      throw new CliError(`\`${what}\` cannot be undone: re-run with --yes to confirm.`, ExitCode.USAGE)
    }
  }
  render(io, command, await auth.send(options.transport, call), Boolean(parsed.flags.json), [bin, ...argv])
  return ExitCode.OK
}

function report(api: Api, io: Io, bin: string, error: unknown): number {
  if (error instanceof CliError) {
    io.err(`error: ${error.message}`)
    return error.exitCode
  }
  if (isApiError(error)) {
    const code = exitCodeOf(error.code)
    io.err(`error: ${error.message}`)
    if (error.code === 'UNAUTHORIZED' && hint(api, bin)) io.err(hint(api, bin).trim())
    return code
  }
  io.err(`error: ${error instanceof Error ? error.message : String(error)}`)
  return ExitCode.ERROR
}
