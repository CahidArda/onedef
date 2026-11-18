// The whole CLI: commands, help, output, exit codes and login, derived from the contract.
export { runCli, type RunCliOptions } from './run.js'
export type { CliIo } from './io.js'

// The command tree as data, for wiring into another CLI framework.
export { toCommands, renderCommandHelp, CliError, ExitCode, type Command, type Flag } from './commands.js'

// What a backend serves at `oauth.clientMetadataUrl` (CIMD).
export { cliClientMetadata, DEFAULT_PORTS, type CliClientMetadata, type ClientMetadataOptions } from './oauth.js'

// Where `login` keeps credentials.
export { credentialsPath, configDirEnv } from './paths.js'

// Agent skill generation.
export { toSkillMarkdown, type SkillOptions } from './skill.js'
