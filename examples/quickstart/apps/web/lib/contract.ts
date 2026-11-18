// The contract: what your API is. No server code, so any client can import it.
import { action, collection, defineApi, defineConfig } from 'onedef'
import { z } from 'zod'

export const config = defineConfig({ name: 'notes', description: 'A tiny notes API.' })

const Note = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
})

export const notes = collection(config, {
  name: 'notes',
  description: 'Your notes.',
  id: 'id',
  fields: Note,
  create: { input: z.object({ title: z.string().describe('What to remember') }) },
  actions: {
    complete: action({ summary: 'Mark a note as done', output: Note, needs: 'object' }),
  },
})

export const contract = defineApi(config, { notes })
