// Spawned by stdio.test.ts: the one-call stdio server over the fixture backend.
import { serveMcpStdio } from '../src/index.js'
import { backend } from './fixture.js'

await serveMcpStdio(backend, { scope: { team: 'stdio-team' } })
