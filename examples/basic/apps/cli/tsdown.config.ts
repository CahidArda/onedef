import { defineConfig } from 'tsdown'

// A CLI is a built artifact: bundle everything (the contract, onedef, zod, the oRPC client) into
// one self-contained executable, so `npx acme` needs no runtime resolution
// into workspace TypeScript.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  noExternal: /.*/,
  dts: false,
  clean: true,
})
