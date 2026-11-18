import { z } from 'zod'
import { defineApi, defineConfig, defineService, fail, implement, mutation, query } from 'onedef'

const Song = z.object({ slug: z.string(), title: z.string() })

export const config = defineConfig({
  name: 'misrava',
  version: '1.2.3',
  description: 'French song lessons.',
  auth: { apiKey: { env: 'MISRAVA_KEY' } },
  scopes: { team: { header: 'X-Team', description: 'The team id', required: false } },
})

export const songs = defineService(config, {
  name: 'songs',
  description: 'Song lessons.',
  id: 'slug',
  ops: {
    list: query({ summary: 'List lessons', output: z.array(Song) }),
    get: query({ on: 'member', summary: 'Get one lesson', output: Song }),
    whoami: query({
      summary: 'Who is calling',
      output: z.object({ auth: z.string(), team: z.string() }),
      scope: ['team'],
    }),
    create: mutation({ summary: 'Create a lesson', input: z.object({ title: z.string().min(1) }), output: Song }),
    remove: mutation({ on: 'member', summary: 'Delete a lesson', destructive: true, idempotent: true }),
    hidden: query({ summary: 'Internal', mcp: { expose: false } }),
  },
})

export const contract = defineApi(config, { songs })

export const backend = implement(contract, {
  context: ({ request, auth }) => ({
    authorization: request?.headers.get('authorization') ?? (auth?.apiKey ? `key ${auth.apiKey}` : 'none'),
  }),
  songs: {
    list: () => [{ slug: 'a', title: 'A' }],
    get: ({ id }) => (id === 'a' ? { slug: 'a', title: 'A' } : fail('NOT_FOUND', `No lesson "${id}"`)),
    whoami: ({ ctx, scope }) => ({ auth: ctx.authorization, team: scope.team ?? 'none' }),
    create: ({ input }) => ({ slug: input.title.toLowerCase(), title: input.title }),
    remove: () => undefined,
    hidden: () => undefined,
  },
})
