import { getRequestListener } from '@hono/node-server'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import sirv from 'sirv'
import { handle, isBackendPath } from './handler.js'

// Production entry: the same handler vite mounts in dev, with the built
// frontend behind it. One process, one port.
const PORT = Number(process.env.PORT ?? 3000)
const backend = getRequestListener(handle)
const assets = sirv(fileURLToPath(new URL('../dist', import.meta.url)), { single: true })

createServer((req, res) => (isBackendPath(req.url ?? '/') ? backend(req, res) : assets(req, res))).listen(PORT, () =>
  console.log(`upstash example on http://localhost:${PORT}  (/, /api, /api/openapi.json, /mcp)`),
)
