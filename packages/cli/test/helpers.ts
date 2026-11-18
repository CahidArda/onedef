import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import type { Api } from 'onedef'
import { runCli, type RunCliOptions } from '../src/index.js'

/** Run the CLI in-process with captured output and a throwaway config dir. */
export async function run(
  api: Api<any, any>,
  argv: string[],
  options: Omit<RunCliOptions, 'argv' | 'io'> & {
    env?: Record<string, string | undefined>
    stdin?: string
    openBrowser?: (url: string) => unknown
    /** Pretend to be an interactive terminal (stdin and stdout). */
    tty?: boolean
  },
) {
  let stdout = ''
  let stderr = ''
  const stdin = Readable.from(options.stdin === undefined ? [] : [options.stdin]) as Readable & { isTTY?: boolean }
  if (options.tty) stdin.isTTY = true
  const code = await runCli(api, {
    ...options,
    argv,
    io: {
      stdout: { write: (text: string) => (stdout += text), isTTY: Boolean(options.tty) },
      stderr: { write: (text: string) => (stderr += text) },
      stdin,
      env: options.env ?? {},
      openBrowser: options.openBrowser ?? (() => {}),
    },
  })
  return { code, stdout, stderr }
}

export const tempConfig = (bin: string) => ({
  [`${bin.toUpperCase()}_CONFIG_DIR`]: mkdtempSync(join(tmpdir(), 'onedef-cli-')),
})
