import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/build.ts', 'src/server.ts', 'src/mcp-app.tsx'],
  format: ['esm'],
  dts: true,
  clean: true,
})
