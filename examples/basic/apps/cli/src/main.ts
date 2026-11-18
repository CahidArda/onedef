#!/usr/bin/env node
import { contract } from '@example/recipe'
import { runCli } from '@onedef/cli'
import { rpc } from '@onedef/orpc/client'

// Commands, flags, tables, --team on scoped commands, the --yes guard and
// `login --with-token` are all derived from the contract. Calls go to the
// app's backend over RPC; the binary ships no handler code.
await runCli(contract, {
  transport: rpc({ url: process.env.ACME_API_URL ?? 'http://localhost:3000/api' }),
  scope: () => ({ team: process.env.ACME_TEAM }),
})
