import { createInterface } from 'node:readline/promises'
import { CliError } from './commands.js'
import { openBrowser } from './oauth.js'

type Input = NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (mode: boolean) => unknown }

/**
 * The process plumbing `runCli` touches. Every piece is injectable, so a test
 * (or an embedding app) can run the CLI without a terminal, a browser or
 * the real environment.
 */
export interface CliIo {
  stdout?: { write(text: string): unknown; isTTY?: boolean }
  stderr?: { write(text: string): unknown }
  stdin?: Input
  env?: Record<string, string | undefined>
  /** Default: `open` / `xdg-open` / `start`. The URL is printed as well, so a no-op is fine. */
  openBrowser?: (url: string) => unknown
}

export interface Io {
  out(line: string): void
  err(line: string): void
  /** Write to stderr without a newline — for prompts. */
  prompt(text: string): void
  stdin: Input
  stdout: { isTTY?: boolean }
  env: Record<string, string | undefined>
  openBrowser: (url: string) => unknown
}

export function resolveIo(io: CliIo = {}): Io {
  const stdout = io.stdout ?? process.stdout
  const stderr = io.stderr ?? process.stderr
  return {
    out: (line) => void stdout.write(`${line}\n`),
    err: (line) => void stderr.write(`${line}\n`),
    prompt: (text) => void stderr.write(text),
    stdin: io.stdin ?? process.stdin,
    stdout,
    env: io.env ?? process.env,
    openBrowser: io.openBrowser ?? openBrowser,
  }
}

export async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let text = ''
  for await (const chunk of stream) text += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  return text
}

/** Read a line with echo off: a pasted key must not end up in the scrollback. */
export function promptSecret(io: Io, question: string): Promise<string> {
  const { stdin } = io
  if (!stdin.setRawMode) return readAll(stdin)
  io.prompt(question)
  stdin.setRawMode(true)
  stdin.setEncoding('utf8')
  stdin.resume()
  return new Promise((resolve, reject) => {
    let value = ''
    const done = () => {
      stdin.setRawMode!(false)
      stdin.pause()
      stdin.off('data', onData)
      io.prompt('\n')
    }
    const onData = (chunk: string | Buffer) => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n' || char === '\u0004') return (done(), resolve(value))
        if (char === '\u0003') return (done(), reject(new CliError('Cancelled.', 130)))
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char
      }
    }
    stdin.on('data', onData)
  })
}

export async function confirm(io: Io, question: string): Promise<boolean> {
  const rl = createInterface({ input: io.stdin, output: process.stderr })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  } finally {
    rl.close()
  }
}
