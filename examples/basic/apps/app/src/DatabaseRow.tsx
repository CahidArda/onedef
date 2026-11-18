import { useState } from 'react'
import { client, type Database } from './client.js'

/**
 * Every type here comes from the contract: `db.state` is 'active' | 'deleted',
 * and `db.rest_token` is a compile error, because list rows omit credentials.
 * Only `client.redis.get` returns them.
 */
export function DatabaseRow({ db, onChanged }: { db: Database; onChanged: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(db.database_name)
  const [endpoint, setEndpoint] = useState<string>()
  const { database_id } = db

  return (
    <tr style={{ borderTop: '1px solid #ddd' }}>
      <td style={{ padding: '0.4rem 0' }}>
        {renaming ? (
          <form
            style={{ display: 'inline' }}
            onSubmit={(e) => {
              e.preventDefault()
              void client.redis.rename({ database_id, name }).then(() => {
                setRenaming(false)
                onChanged()
              })
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </form>
        ) : (
          <strong>{db.database_name}</strong>
        )}{' '}
        <small>
          {db.region} · {db.state}
        </small>
        {endpoint && (
          <div>
            <small>endpoint: {endpoint}</small>
          </div>
        )}
      </td>
      <td style={{ textAlign: 'right' }}>
        <button onClick={() => setRenaming((r) => !r)}>{renaming ? 'cancel' : 'rename'}</button>{' '}
        <button onClick={() => void client.redis.get({ database_id }).then((d) => setEndpoint(d.endpoint))}>
          show endpoint
        </button>{' '}
        <button
          style={{ color: 'crimson' }}
          onClick={() =>
            confirm(`Delete ${db.database_name}?`) && void client.redis.delete({ database_id }).then(onChanged)
          }
        >
          delete
        </button>
      </td>
    </tr>
  )
}
