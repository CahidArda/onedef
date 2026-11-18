#!/usr/bin/env node
// load .env before anything reads process.env
import 'dotenv/config'
import { backend } from '@upstash-example/recipe/backend'
import { serveMcpStdio } from '@onedef/mcp'

// Same as the CLI: descriptor ops go straight to api.upstash.com, `query`
// runs here. stdio is single-tenant, so credentials (UPSTASH_EMAIL +
// UPSTASH_API_KEY) and the team are read from the environment once.
await serveMcpStdio(backend, { scope: { team: process.env.UPSTASH_TEAM_ID } })
console.error('upstash-redis mcp server listening on stdio')
