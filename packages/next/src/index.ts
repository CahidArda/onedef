/**
 * Next.js integration. Two functions, one per file a project touches:
 *
 *   // next.config.ts
 *   export default withOnedef(nextConfig)
 *
 *   // app/mcp/route.ts — from '@onedef/next/server'
 *   const handler = createMcpHandler(backend, { app: serveMcpApp({ tools: ['songs.get'] }) })
 *
 * With `app/mcp-app.tsx` present, `next build` builds the MCP App into one
 * HTML file before Next compiles, `next dev` keeps it rebuilt as you edit, the
 * file is traced into the `/mcp` route's deployment, and `serveMcpApp()` knows
 * where it is. Without the entry file, the wrapper changes nothing.
 *
 * This entry is for next.config only: it reaches Vite (lazily), so a route
 * importing it would make Next bundle a bundler. Routes import
 * `@onedef/next/server`, which has no path to Vite.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { InlineConfig } from 'vite'
import { ENV, HTML } from './paths.js'
import type { ResolvedMcpApp } from './build.js'

export interface WithOnedefOptions {
  /** The Next project directory. Default: `process.cwd()`, where `next` runs. */
  dir?: string
  /** The MCP App, or `false` to never build one. */
  mcpApp?:
    | false
    | {
        /** The entry exporting `defineMcpApp(...)`. Default `app/mcp-app.tsx` (or `src/app/mcp-app.tsx`). */
        entry?: string
        /** The route that serves it, for file tracing. Default `/mcp`. */
        route?: string
        /** Global stylesheet to include. Default: `app/globals.css` (or `src/app/globals.css`) when present. `false` for none. */
        css?: string | false
        /** Add Tailwind's Vite plugin. Default: when the project has `tailwindcss` installed. */
        tailwind?: boolean
        /** Escape hatch: merged over the defaults (react, tailwind, singlefile, `@/` → project root). */
        vite?: InlineConfig | ((config: InlineConfig) => InlineConfig | Promise<InlineConfig>)
      }
}

/**
 * The two config fields the wrapper writes. Generic over the rest, so it takes
 * whatever `NextConfig` the project's own Next version declares, and returns it.
 */
interface ConfigFields {
  env?: Record<string, string | undefined>
  outputFileTracingIncludes?: Record<string, string[]>
}

type ConfigInput<TConfig> = TConfig | ((phase: string, context: { defaultConfig: any }) => TConfig | Promise<TConfig>)

// Next loads the config more than once (the CLI, then the server or build
// workers it forks). The first load in the process tree builds or watches;
// children inherit this mark from the environment and skip.
const STARTED = '__ONEDEF_MCP_APP_STARTED'

const firstExisting = (dir: string, candidates: string[]) =>
  candidates.map((candidate) => path.join(dir, candidate)).find((file) => existsSync(file))

async function resolveApp(options: WithOnedefOptions): Promise<(ResolvedMcpApp & { route: string }) | undefined> {
  if (options.mcpApp === false) return undefined
  const config = options.mcpApp ?? {}
  const dir = path.resolve(options.dir ?? process.cwd())
  const entry = config.entry
    ? path.resolve(dir, config.entry)
    : firstExisting(dir, ['app/mcp-app.tsx', 'src/app/mcp-app.tsx'])
  if (!entry || !existsSync(entry)) return undefined
  const { installed } = await import('./build.js')
  const css =
    config.css === false
      ? undefined
      : config.css
        ? path.resolve(dir, config.css)
        : firstExisting(dir, ['app/globals.css', 'src/app/globals.css'])
  return {
    dir,
    entry,
    ...(css ? { css } : {}),
    workDir: path.join(dir, '.onedef/mcp-app'),
    html: path.join(dir, HTML),
    tailwind: config.tailwind ?? installed(dir, 'tailwindcss'),
    route: config.route ?? '/mcp',
    ...(config.vite ? { vite: config.vite } : {}),
  }
}

const log = (message: string) => console.log(` ✓ onedef: ${message}`)

/**
 * Wrap the Next config. Keyed off the phase Next passes in: the production
 * build awaits a one-off MCP App build (so the file exists before Next traces
 * the routes), the dev server starts a watch build that lives as long as the
 * dev server's process. Composes with other wrappers: pass a config object or
 * a config function.
 */
export function withOnedef<TConfig extends object = ConfigFields>(
  nextConfig: ConfigInput<TConfig> = {} as TConfig,
  options: WithOnedefOptions = {},
) {
  return async (phase: string, context: { defaultConfig: any }): Promise<TConfig & ConfigFields> => {
    const config = (typeof nextConfig === 'function' ? await nextConfig(phase, context) : nextConfig) as TConfig &
      ConfigFields
    const app = await resolveApp(options)
    if (!app) return config

    if (!process.env[STARTED] && (phase === 'phase-production-build' || phase === 'phase-development-server')) {
      process.env[STARTED] = '1'
      const build = await import('./build.js')
      if (phase === 'phase-production-build') {
        await build.buildMcpApp(app)
        log(`MCP App built (${HTML})`)
      } else {
        const watcher = await build.watchMcpApp(app, log)
        const stop = () => void watcher.close()
        process.once('exit', stop)
        process.once('SIGINT', stop)
        process.once('SIGTERM', stop)
      }
    }

    const includes = config.outputFileTracingIncludes ?? {}
    return {
      ...config,
      env: { ...config.env, [ENV]: HTML },
      outputFileTracingIncludes: {
        ...includes,
        [app.route]: [...(includes[app.route] ?? []), `./${HTML}`],
      },
    }
  }
}

export type { ResolvedMcpApp } from './build.js'
