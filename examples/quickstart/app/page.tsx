'use client'
// The page calls the API through the typed client: same types as the contract.
import { rpc } from '@onedef/orpc/client'
import { createClient } from 'onedef'
import { useEffect, useState } from 'react'
import { contract } from '@/lib/contract'

const api = createClient(contract, rpc({ url: '/api' }))

export default function Home() {
  const [notes, setNotes] = useState<Awaited<ReturnType<typeof api.notes.list>>>([])
  useEffect(() => {
    api.notes.list().then(setNotes)
  }, [])
  return (
    <ul>
      {notes.map((note) => (
        <li key={note.id}>{note.done ? '✓' : '·'} {note.title}</li>
      ))}
    </ul>
  )
}
