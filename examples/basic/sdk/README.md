# @example/basic-sdk

The releasable SDK, and the answer to "how does a released SDK work if the contract
package is never published?"

```ts
import { createAcmeClient, type Database } from '@example/basic-sdk'

const acme = createAcmeClient({ url: 'https://acme.dev/api', apiKey: () => process.env.ACME_API_KEY })
const dbs: Database[] = await acme.redis.list({}, { scope: { team: 'team_42' } })
```

`src/index.ts` imports the contract by relative path (`../../contract/src/contract.js`),
and the build makes the artifact self-contained:

| half | tool | what lands in `dist/` |
| --- | --- | --- |
| runtime | `tsup` | `createClient(contract, rpc(...))` plus the contract's schemas. `backend.ts` is never imported, so no handler ships. |
| types | `tsc -p tsconfig.dts.json` | the SDK's `.d.ts` plus the contract's, in `dist/sdk/…` and `dist/contract/…` |

Its runtime dependencies are all published packages: `onedef`, `@onedef/orpc`, `zod`, peer
`@orpc/client`.

```bash
pnpm --filter @example/basic-sdk build     # from the repo root
pnpm build                                 # from this folder
```

To release: remove `"private": true`, version it, `npm publish`.

Docs: [SDK](https://onedef.cahidarda.com/docs/clients/sdk)
