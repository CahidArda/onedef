import { useCallback, useEffect, useState } from 'react'
import { client, type RedisDb } from './client.js'
import { CreateForm } from './CreateForm.js'
import { DatabaseRow } from './DatabaseRow.js'

export function App() {
  const [dbs, setDbs] = useState<RedisDb[]>([])
  const [error, setError] = useState<string>()

  const refresh = useCallback(async () => {
    setError(undefined)
    try {
      setDbs(await client.redis.list({}))
    } catch (e) {
      setDbs([])
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.2rem' }}>
        Upstash Redis <button onClick={() => void refresh()}>refresh</button>
      </h1>

      {error && (
        <p style={{ color: 'crimson' }}>
          {error} — are UPSTASH_EMAIL and UPSTASH_API_KEY set in the server&apos;s .env?
        </p>
      )}

      <CreateForm onCreated={refresh} />

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
