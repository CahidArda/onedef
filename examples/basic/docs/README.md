# @example/basic-docs

This folder is the Mintlify site; `scripts/` holds the generator and its `package.json`.
`scripts/generate.ts` is `generateOpenApi(contract)` plus `writeMintlifySite(contract, { spec })`,
both on `forMode(contract, 'oauth')`, so the public docs never mention tokens or apikey-only
ops. No backend needed.

```bash
pnpm --filter @example/basic-docs build      # regenerate docs.json, openapi.json, api-reference/
pnpm --filter @example/basic-docs dev        # regenerate + mint dev
pnpm --filter @example/basic-docs validate   # regenerate + mint validate
```

From `scripts/`: `pnpm build`, `pnpm dev`, `pnpm validate`.

`docs.json`, `openapi.json` and `api-reference/` are generated (gitignored); `index.mdx` is
yours: written once, never overwritten.

Docs: [API docs](https://onedef.cahidarda.com/docs/serve/api-docs)
