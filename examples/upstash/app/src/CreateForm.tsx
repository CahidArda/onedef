import { useState } from 'react'
import { REGIONS } from '@example/upstash-contract'
import { client } from './client.js'

/** `create` is a collection mutation: no database_id in its input, by type. */
export function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [region, setRegion] = useState<(typeof REGIONS)[number]>('us-east-1')
  const [busy, setBusy] = useState(false)

  return (
    <form
      style={{ margin: '1rem 0' }}
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        void client.redis
          .create({ name, primary_region: region })
          .then(() => {
            setName('')
            onCreated()
          })
          .finally(() => setBusy(false))
      }}
    >
      <input placeholder="new database name" value={name} onChange={(e) => setName(e.target.value)} required />{' '}
      <select value={region} onChange={(e) => setRegion(e.target.value as (typeof REGIONS)[number])}>
        {REGIONS.map((r) => (
          <option key={r}>{r}</option>
        ))}
      </select>{' '}
      <button disabled={busy}>create</button>
    </form>
  )
}
