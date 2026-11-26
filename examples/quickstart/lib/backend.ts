// The backend: one handler per op. Server only.
import { fail, implement } from 'onedef'
import { contract } from './contract'

// A Map stands in for your database.
const db = new Map<string, { id: string; title: string; done: boolean }>()

export const backend = implement(contract, {
  notes: {
    list: () => [...db.values()],
    get: ({ id }) => db.get(id) ?? fail('NOT_FOUND', `No note "${id}"`),
    create: ({ input }) => {
      const note = { id: crypto.randomUUID(), title: input.title, done: false }
      db.set(note.id, note)
      return note
    },
    complete: ({ object }) => {
      const note = { ...object, done: true }
      db.set(note.id, note)
      return note
    },
  },
})
