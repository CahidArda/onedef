import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * The backend, mounted into vite's dev server: /api and /mcp share the
 * frontend's port and process, so `vite` is the only dev command.
 *
 * The handler loads through ssrLoadModule rather than a top-level import:
 * this config file is bundled before vite's TS pipeline exists, so importing
 * the recipe here would hand node raw .ts.
 */
function backendPlugin(): Plugin {
  return {
    name: 'onedef-backend',
    configureServer(server) {
      const ready = Promise.all([
        import('@hono/node-server'),
        server.ssrLoadModule('/server/handler.ts') as Promise<typeof import('./server/handler.js')>,
      ]).then(([{ getRequestListener }, handler]) => ({ ...handler, listener: getRequestListener(handler.handle) }))
      server.middlewares.use((req, res, next) => {
        ready
          .then(({ isBackendPath, listener }) => (isBackendPath(req.url ?? '/') ? listener(req, res) : next()))
          .catch(next)
      })
    },
  }
}

// same port as `pnpm start`, so the CLI, MCP and SDK defaults work against either
export default defineConfig({ plugins: [react(), backendPlugin()], server: { port: 3000, strictPort: true } })
