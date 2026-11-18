# @example/sdk

The **releasable** SDK, and the answer to "how do released SDKs work if the
recipe is never published?"

```ts
import { createAcmeClient, type Database } from '@example/sdk'

const acme = createAcmeClient({ url: 'https://acme.dev/api', apiKey: () => process.env.ACME_API_KEY })
const dbs: Database[] = await acme.redis.list({}, { scope: { team: 'team_42' } })
```

The SDK imports the contract **relatively**, and the build makes the artifact
self-contained:

| half    | tool                       | what lands in `dist/`                                                                                                       |
| ------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| runtime | `tsup`                     | `createClient(contract, rpc(...))` plus the contract (zod schemas). `backend.ts` is never imported, so no handler can ship. |
| types   | `tsc -p tsconfig.dts.json` | the SDK's d.ts **plus the contract's d.ts**, emitted into `dist/recipe/…`                                                   |

Its real dependencies are all published packages: `onedef`, `@onedef/orpc`,
`zod`, peer `@orpc/client`.

```bash
pnpm --filter @example/sdk build
```

To release: remove `"private": true`, version it, `npm publish`. The recipe never moves.
