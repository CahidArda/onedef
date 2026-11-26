import { defineConfig } from 'tsup'

// Runtime only; declarations come from tsc (tsconfig.dts.json), which emits
// the contract's d.ts into dist so the published package is self-contained.
export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], dts: false, clean: true })
