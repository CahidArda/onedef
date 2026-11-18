/**
 * The route side of `withOnedef()`: what `app/mcp/route.ts` imports. Kept apart
 * from the config entry, which reaches Vite — a route importing that would make
 * Next bundle a bundler into the function.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { McpAppOptions as McpAppResource } from '@onedef/mcp'
import { ENV, HTML } from './paths.js'

export interface ServeMcpAppOptions<TRef extends string = string> extends Omit<McpAppResource<TRef>, 'html'> {
  /** The built file. Default: where `withOnedef()` builds it. */
  file?: string
}

/**
 * The `app` option for `createMcpHandler`: the built MCP App, read from where
 * `withOnedef()` put it — so you never pass `html` yourself. `tools` are
 * checked against the contract where it is passed to `createMcpHandler`. Re-read on every request in development (the watch
 * build rewrites it), read once in production.
 */
export function serveMcpApp<const TRef extends string = never>(
  options: ServeMcpAppOptions<TRef> = {},
): McpAppResource<TRef> {
  const { file, ...resource } = options
  const target = path.resolve(/* turbopackIgnore: true */ process.cwd(), file ?? process.env[ENV] ?? HTML)
  let cached: Promise<string> | undefined
  const read = () =>
    readFile(/* turbopackIgnore: true */ target, 'utf8').catch((error: NodeJS.ErrnoException) => {
      cached = undefined
      if (error.code === 'ENOENT') {
        throw new Error(
          `The MCP App is not built (${target}). It builds during \`next build\` and \`next dev\` ` +
            'when next.config wraps its config in withOnedef() and app/mcp-app.tsx exists.',
        )
      }
      throw error
    })
  return {
    ...resource,
    html: () => (process.env.NODE_ENV === 'production' ? (cached ??= read()) : read()),
  }
}
