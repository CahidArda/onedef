import { useState } from 'react'
import { client, type RedisDb } from './client.js'

export function DatabaseRow({ db, onChanged }: { db: RedisDb; onChanged: () => void }) {
  const [command, setCommand] = useState('PING')
  const [output, setOutput] = useState<string>()

  const run = (fn: () => Promise<unknown>) => void fn().then(onChanged)

  return (
    <tr style={{ borderTop: '1px solid #ddd', verticalAlign: 'top' }}>
      <td style={{ padding: '0.5rem 0' }}>
        <strong>{db.database_name}</strong>{' '}
        <small>
          {db.primary_region} · {db.state}
        </small>
        <div style={{ marginTop: '0.3rem' }}>
          {/* query runs on the server: endpoint + rest_token never reach this bundle */}
          <input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            style={{ width: '14rem' }}
            placeholder="SET greeting hello"
          />{' '}
          <button
            onClick={() =>
              void client.redis
                .query({ database_id: db.database_id, command: command.trim().split(/\s+/) })
                .then((r) => setOutput(JSON.stringify(r.result)))
                .catch((e) => setOutput(String(e)))
            }
          >
            run
          </button>
          {output !== undefined && <code style={{ marginLeft: '0.5rem' }}>{output}</code>}
        </div>
      </td>
      <td style={{ textAlign: 'right', padding: '0.5rem 0' }}>
        <button
          onClick={() => {
            const name = prompt('New name', db.database_name)
            if (name) run(() => client.redis.rename({ database_id: db.database_id, name }))
          }}
        >
          rename
        </button>{' '}
        <button
          style={{ color: 'crimson' }}
          onClick={() => {
            if (confirm(`Delete ${db.database_name}? This cannot be undone.`))
              run(() => client.redis.delete({ database_id: db.database_id }))
          }}
        >
          delete
        </button>
      </td>
    </tr>
  )
}
