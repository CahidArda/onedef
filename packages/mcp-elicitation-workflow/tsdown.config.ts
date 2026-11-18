import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/mcp.ts', 'src/redis.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
})
