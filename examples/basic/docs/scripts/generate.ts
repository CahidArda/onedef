import { contract } from '@example/basic-contract'
import { writeMintlifySite } from '@onedef/docs'
import { generateOpenApi } from '@onedef/orpc'
import { forMode } from 'onedef'

// Public docs describe the OAuth surface: redacted fields and apikey-only ops
// never reach the spec, so they cannot reach a page either.
const publicContract = forMode(contract, 'oauth')

// The spec comes from the same router the server runs, so docs cannot drift.
// No handlers needed: this runs at build time from the contract alone.
const spec = await generateOpenApi(publicContract, { servers: [{ url: 'http://localhost:3000' }] })

const files = await writeMintlifySite(publicContract, {
  dir: new URL('..', import.meta.url),
  name: 'Acme',
  colors: { primary: '#00E9A3', light: '#00E9A3', dark: '#00C48A' },
  spec,
})
console.log(files.join('\n'))
