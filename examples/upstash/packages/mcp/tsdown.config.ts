import { defineConfig } from 'tsdown'

// Same story as the CLI: one self-contained binary an agent can launch as a
// subprocess — contract, backend, MCP SDK, @upstash/redis all bundled.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  noExternal: /.*/,
  dts: false,
  clean: true,
})
