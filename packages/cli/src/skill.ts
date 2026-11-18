import type { Api } from 'onedef'
import { toCommands } from './commands.js'

export interface SkillOptions {
  /** The installed binary name, e.g. `misrava`. */
  bin: string
  /** One line for the frontmatter: when should an agent reach for this CLI? */
  description: string
  /** Extra environment variables worth teaching the agent (the auth env var is added for you). */
  env?: { name: string; description: string }[]
}

/**
 * A SKILL.md for agent harnesses that load markdown skills (Claude Code and
 * friends). Everything in it is derived from the contract, so regenerating it
 * after a contract change keeps the agent's picture of the CLI exact.
 */
export function toSkillMarkdown(api: Api, options: SkillOptions): string {
  const { bin } = options
  const auth = api.config.auth
  const lines: string[] = [
    '---',
    `name: ${bin}-cli`,
    // quoted: a description naturally contains colons
    `description: ${JSON.stringify(options.description)}`,
    '---',
    '',
    `# ${bin} CLI`,
    '',
    `Run commands as \`${bin} <service> <command> [args] [flags]\`. Lists print as tables, everything else as JSON; pass \`--json\` to always get JSON. \`${bin} <command> --help\` shows every flag.`,
    '',
    'Exit codes: 0 ok, 1 error, 2 bad usage or input, 3 not found, 4 not authenticated, 5 API error.',
    '',
  ]

  const env = [
    ...(auth?.apiKey?.env ? [{ name: auth.apiKey.env, description: auth.apiKey.description ?? 'API key' }] : []),
    ...(auth?.basic?.userEnv && auth.basic.passwordEnv
      ? [
          { name: auth.basic.userEnv, description: 'username (basic auth)' },
          { name: auth.basic.passwordEnv, description: 'password or key (basic auth)' },
        ]
      : []),
    ...(options.env ?? []),
  ]
  if (auth) {
    lines.push('## Authentication', '')
    if (auth.apiKey?.env) {
      lines.push(`- Preferred for agents: set \`${auth.apiKey.env}\`. It takes precedence over any stored login.`)
    }
    if (auth.apiKey) lines.push(`- Or store a key once: \`echo "$KEY" | ${bin} login --with-token\`.`)
    if (auth.oauth) {
      lines.push(`- A human can sign in with \`${bin} login\` (opens a browser). Do not run it yourself unattended.`)
    }
    lines.push(`- \`${bin} whoami\` shows which credentials are in use; exit code 4 means none are.`, '')
  }
  if (env.length) {
    lines.push('## Environment', '')
    for (const variable of env) lines.push(`- \`${variable.name}\` — ${variable.description}`)
    lines.push('')
  }

  lines.push('## Commands', '')
  for (const command of toCommands(api)) {
    const flags = [...command.scopeFlags, ...command.flags]
    const usage = [
      bin,
      ...command.path,
      ...command.args.map((arg) => `<${arg.name}>`),
      ...flags.map((flag) =>
        flag.required
          ? `--${flag.name} <${flag.type}>`
          : `[--${flag.name}${flag.type === 'boolean' ? '' : ` <${flag.type}>`}]`,
      ),
    ].join(' ')
    lines.push(
      `### \`${usage}\``,
      '',
      command.summary + (command.destructive ? ' **Destructive**: requires `--yes`; confirm with the user first.' : ''),
      '',
    )
    if (command.description) lines.push(command.description, '')
    if (flags.length) {
      for (const flag of flags) {
        const notes = [
          flag.type,
          flag.required ? 'required' : undefined,
          flag.enum ? `one of ${flag.enum.join(', ')}` : undefined,
        ]
        lines.push(
          `- \`--${flag.name}\` (${notes.filter(Boolean).join(', ')})${flag.description ? ` — ${flag.description}` : ''}`,
        )
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}
