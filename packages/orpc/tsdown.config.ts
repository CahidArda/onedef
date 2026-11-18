import { defineConfig } from 'tsdown'
// './client' is a separate entry on purpose: it must never share a chunk with
// code importing @orpc/server, or browser bundles inherit the server
export default defineConfig({ entry: ['src/index.ts', 'src/client.ts'], format: ['esm'], dts: true, clean: true })
