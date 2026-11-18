import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/fs.ts', 'src/redis.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['@upstash/redis'],
})
