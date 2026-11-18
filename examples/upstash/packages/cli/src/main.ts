#!/usr/bin/env node
// load .env before anything reads process.env
import 'dotenv/config'
import { contract } from '@upstash-example/recipe'
import { backend } from '@upstash-example/recipe/backend'
import { runCli } from '@onedef/cli'
import { local } from 'onedef'

// No server in between: every op with an `http` descriptor goes straight to
// api.upstash.com (the backend proxies it in process, exactly what `http()`
// would do), and `query`, which has no descriptor, runs its handler here.
// With `transport: http()` instead, `redis query` would fail: a contract that
// mixes modes needs its handlers wherever they are called.
// Credentials: UPSTASH_EMAIL + UPSTASH_API_KEY (Basic), from .env or the environment.
await runCli(contract, {
  transport: local(backend),
  scope: () => ({ team: process.env.UPSTASH_TEAM_ID }),
})
