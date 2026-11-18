import { defineConfig } from 'tsdown'

// A CLI is a built artifact: bundle everything — contract, backend, onedef, zod,
// @upstash/redis, dotenv — into one self-contained executable. Nothing in
// devDependencies leaks to consumers; `npm publish` ships dist only.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  noExternal: /.*/,
  dts: false,
  clean: true,
})
