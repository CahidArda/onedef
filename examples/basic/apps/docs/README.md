# @example/docs

This folder _is_ the Mintlify site; `scripts/` holds the generator and its
package.json. `scripts/generate.ts` is `generateOpenApi(contract)` plus
`writeMintlifySite(contract, { spec })`, both on `forMode(contract, 'oauth')`
so public docs never mention tokens or apikey-only ops. No backend needed.

```bash
pnpm --filter @example/docs build      # regenerate docs.json, openapi.json, api-reference/
pnpm --filter @example/docs dev        # regenerate + mint dev
pnpm --filter @example/docs validate   # regenerate + mint validate
```

`docs.json`, `openapi.json` and `api-reference/` are generated (gitignored);
`index.mdx` is yours: written once, never touched again.
