import { homedir } from 'node:os'
import { join } from 'node:path'

/** `acme` → `ACME_CONFIG_DIR`. */
export const configDirEnv = (bin: string) => `${bin.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_CONFIG_DIR`

export function credentialsPath(bin: string, env: Record<string, string | undefined>): string {
  const dir = env[configDirEnv(bin)] ?? join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), bin)
  return join(dir, 'credentials.json')
}
