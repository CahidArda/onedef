#!/usr/bin/env node
import { contract } from '@example/basic-contract'
import { serveMcpStdio } from '@onedef/mcp'
import { rpc } from '@onedef/orpc/client'

// Forward to the app's backend rather than running the handlers here: this
// binary can then be published without any server code, and every agent sees
// the same data as the web app (an in-process backend would get its own empty
// store). Remote agents use the app's /mcp instead; stdio is for agents that
// launch a local subprocess. Credentials come from ACME_API_KEY.
await serveMcpStdio(contract, {
  transport: rpc({ url: process.env.ACME_API_URL ?? 'http://localhost:3000/api' }),
  scope: { team: process.env.ACME_TEAM },
})
console.error('acme mcp server listening on stdio')
