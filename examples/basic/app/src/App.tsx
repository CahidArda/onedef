import { useCallback, useEffect, useState } from 'react'
import { client, type Database } from './client.js'
import { DatabaseRow } from './DatabaseRow.js'

export function App() {
  const [team, setTeam] = useState('')
  const [name, setName] = useState('')
  const [dbs, setDbs] = useState<Database[]>([])
  const [error, setError] = useState<string>()
  // per-call scope: the team travels with each call, the client is never rebuilt
  const scope = team ? { scope: { team } } : undefined

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      setDbs(await client.redis.list({}, team ? { scope: { team } } : undefined))
    } catch (e) {
      setDbs([])
      setError(String(e))
    }
  }, [team])

  useEffect(() => void refresh(), [refresh])

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.2rem' }}>Redis databases</h1>
      <label>
        Team <input value={team} placeholder="personal" onChange={(e) => setTeam(e.target.value)} />
      </label>{' '}
      <form
        style={{ display: 'inline' }}
        onSubmit={(e) => {
          e.preventDefault()
          // `create` is a collection mutation: no database_id in its input, by type
          void client.redis.create({ name }, scope).then(
            () => {
              setName('')
              void refresh()
            },
            (e) => setError(String(e)),
          )
        }}
      >
        <input value={name} placeholder="new database" onChange={(e) => setName(e.target.value)} required />{' '}
        <button>create</button>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
        <tbody>
          {dbs.map((db) => (
            <DatabaseRow key={db.database_id} db={db} onChanged={refresh} />
          ))}
        </tbody>
      </table>
    </main>
  )
}
