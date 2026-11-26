import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import { defineApi, defineConfig, defineService, fail, implement, local, mutation, query } from 'onedef'
import { renderCommandHelp, toCommands, toSkillMarkdown } from '../src/index.js'
import { run } from './helpers.js'

const Song = z.object({ slug: z.string(), title: z.string(), plays: z.number(), tags: z.array(z.string()) })

const config = defineConfig({
  name: 'acme',
  description: 'French song lessons.',
  scopes: { team: { header: 'X-Team', description: 'Team to act in', required: true } },
})

const songs = defineService(config, {
  name: 'songs',
  description: 'Song lessons.',
  id: 'slug',
  ops: {
    list: query({ summary: 'List lessons', output: z.array(Song) }),
    get: query({ on: 'member', summary: 'Get one lesson', output: Song }),
    create: mutation({
      summary: 'Create a lesson',
      input: z.object({
        title: z.string().min(1).describe('Lesson title'),
        level: z.enum(['a1', 'b2']).optional(),
      }),
      output: Song,
      scope: ['team'],
    }),
    setOffset: mutation({
      on: 'member',
      summary: 'Shift the lyrics',
      input: z.object({ offsetMs: z.number().describe('Offset in ms'), loop: z.boolean().optional() }),
      output: Song,
    }),
    tag: mutation({ on: 'member', summary: 'Replace tags', input: z.object({ tags: z.array(z.string()) }) }),
    delete: mutation({ on: 'member', summary: 'Delete a lesson', destructive: true }),
  },
})

const contract = defineApi(config, { songs })

const db = () =>
  new Map([
    ['ma-liberte', { slug: 'ma-liberte', title: 'Ma liberté', plays: 3, tags: ['classic'] }],
    ['la-mer', { slug: 'la-mer', title: 'La mer', plays: 10, tags: [] }],
  ])

function backendWith(store = db(), seen: { scope?: unknown; input?: unknown } = {}) {
  return implement(contract, {
    songs: {
      list: async () => [...store.values()],
      get: async ({ id }) => store.get(id) ?? fail('NOT_FOUND', `No lesson "${id}"`),
      create: async ({ input, scope }) => {
        seen.scope = scope
        const song = { slug: input.title.toLowerCase(), title: input.title, plays: 0, tags: [] }
        store.set(song.slug, song)
        return song
      },
      setOffset: async ({ id, input }) => {
        seen.input = input
        return store.get(id) ?? fail('NOT_FOUND', `No lesson "${id}"`)
      },
      tag: async ({ id, input }) => void (store.get(id)!.tags = input.tags),
      delete: async ({ id }) => void store.delete(id),
    },
  })
}

test('command tree: paths, args, typed flags, scope flags, destructive, columns', () => {
  const commands = Object.fromEntries(toCommands(contract).map((command) => [command.path.join(' '), command]))
  assert.deepEqual(Object.keys(commands), [
    'songs list',
    'songs get',
    'songs create',
    'songs set-offset',
    'songs tag',
    'songs delete',
  ])
  assert.deepEqual(commands['songs list']!.columns, ['slug', 'title', 'plays']) // tags (an array) is not a column
  assert.equal(commands['songs get']!.columns, undefined)
  assert.deepEqual(commands['songs get']!.args, [{ name: 'slug', required: true }])
  assert.deepEqual(
    commands['songs set-offset']!.flags.map(({ name, key, type, required }) => ({ name, key, type, required })),
    [
      { name: 'offset-ms', key: 'offsetMs', type: 'number', required: true },
      { name: 'loop', key: 'loop', type: 'boolean', required: false },
    ],
  )
  assert.equal(commands['songs tag']!.flags[0]!.type, 'json')
  assert.deepEqual(commands['songs create']!.flags[1]!.enum, ['a1', 'b2'])
  assert.deepEqual(
    commands['songs create']!.scopeFlags.map((flag) => flag.name),
    ['team'],
  )
  assert.deepEqual(commands['songs list']!.scopeFlags, [])
  assert.equal(commands['songs delete']!.destructive, true)

  const call = commands['songs set-offset']!.toCall(['la-mer'], { 'offset-ms': '-250', loop: 'false' })
  assert.deepEqual(call, { service: 'songs', op: 'setOffset', input: { slug: 'la-mer', offsetMs: -250, loop: false } })
  assert.deepEqual(commands['songs create']!.toCall([], { title: 'X', team: 't2' }, { scope: { team: 't1' } }).scope, {
    team: 't2',
  })
})

test('help: root, service and command', async () => {
  const root = await run(contract, ['--help'], { transport: local(backendWith()) })
  assert.equal(root.code, 0)
  assert.match(root.stdout, /Usage: acme <command>/)
  assert.match(root.stdout, /songs set-offset <slug>\s+Shift the lyrics/)
  assert.doesNotMatch(root.stdout, /login/) // no auth declared, no auth commands

  const service = await run(contract, ['songs'], { transport: local(backendWith()) })
  assert.match(service.stdout, /Song lessons\./)
  assert.match(service.stdout, /songs delete <slug>\s+Delete a lesson/)

  const help = renderCommandHelp(
    toCommands(contract).find((c) => c.op === 'create')!,
    'acme',
  )
  assert.equal(
    help,
    [
      'Usage: acme songs create --team <string> --title <string> [flags]',
      '',
      'Create a lesson',
      '',
      'Flags:',
      '  --title <string>   Lesson title (required)',
      '  --level <a1|b2>',
      '  --team <string>    Team to act in (required)',
    ].join('\n'),
  )
  const viaCli = await run(contract, ['songs', 'set-offset', '--help'], { transport: local(backendWith()) })
  assert.match(viaCli.stdout, /--offset-ms <number>\s+Offset in ms \(required\)/)
  assert.match(viaCli.stdout, /--loop\s/)
})

test('output: a table for lists, JSON for the rest and with --json', async () => {
  const transport = local(backendWith())
  const table = await run(contract, ['songs', 'list'], { transport })
  assert.equal(table.code, 0)
  assert.equal(
    table.stdout,
    ['SLUG        TITLE       PLAYS', 'ma-liberte  Ma liberté  3', 'la-mer      La mer      10', ''].join('\n'),
  )

  const json = await run(contract, ['songs', 'list', '--json'], { transport })
  assert.equal(JSON.parse(json.stdout).length, 2)

  const one = await run(contract, ['songs', 'get', 'la-mer'], { transport })
  assert.deepEqual(JSON.parse(one.stdout), { slug: 'la-mer', title: 'La mer', plays: 10, tags: [] })
})

test('flags are coerced by schema type and reach the handler', async () => {
  const seen: { input?: unknown } = {}
  const store = db()
  const transport = local(backendWith(store, seen))
  const offset = await run(contract, ['songs', 'set-offset', 'la-mer', '--offset-ms', '1500', '--loop'], { transport })
  assert.equal(offset.code, 0, offset.stderr)
  assert.deepEqual(seen.input, { offsetMs: 1500, loop: true })

  const tag = await run(contract, ['songs', 'tag', 'la-mer', '--tags', '["a","b"]'], { transport })
  assert.equal(tag.code, 0, tag.stderr)
  assert.deepEqual(store.get('la-mer')!.tags, ['a', 'b'])
})

test('scope: flag wins over the ambient default, and both reach the handler', async () => {
  const seen: { scope?: unknown } = {}
  const transport = local(backendWith(db(), seen))
  const scope = () => ({ team: 'from-env' })
  await run(contract, ['songs', 'create', '--title', 'Ne me quitte pas'], { transport, scope })
  assert.deepEqual(seen.scope, { team: 'from-env' })
  await run(contract, ['songs', 'create', '--title', 'Ne me quitte pas', '--team', 'flag'], { transport, scope })
  assert.deepEqual(seen.scope, { team: 'flag' })

  const missing = await run(contract, ['songs', 'create', '--title', 'X'], { transport })
  assert.equal(missing.code, 2)
  assert.match(missing.stderr, /pass --team/)
})

test('destructive ops need --yes', async () => {
  const store = db()
  const transport = local(backendWith(store))
  const refused = await run(contract, ['songs', 'delete', 'la-mer'], { transport })
  assert.equal(refused.code, 2)
  assert.match(refused.stderr, /`songs delete la-mer` cannot be undone: re-run with --yes/)
  assert.ok(store.has('la-mer'))

  const done = await run(contract, ['songs', 'delete', 'la-mer', '--yes'], { transport })
  assert.equal(done.code, 0, done.stderr)
  assert.ok(!store.has('la-mer'))
})

test('exit codes: not found 3, invalid input 2, usage 2', async () => {
  const transport = local(backendWith())
  const notFound = await run(contract, ['songs', 'get', 'nope'], { transport })
  assert.deepEqual([notFound.code, notFound.stderr], [3, 'error: No lesson "nope"\n'])

  const invalid = await run(contract, ['songs', 'create', '--title', '', '--team', 't'], { transport })
  assert.equal(invalid.code, 2)
  assert.match(invalid.stderr, /title/)

  for (const argv of [
    ['nope'],
    ['songs', 'nope'],
    ['songs', 'get'],
    ['songs', 'get', 'a', 'b'],
    ['songs', 'list', '--bogus'],
    ['songs', 'set-offset', 'a', '--offset-ms', 'soon'],
    ['songs', 'set-offset', 'a'],
    ['songs', 'tag', 'a', '--tags', 'not json'],
    ['songs', 'create', '--title', 'x', '--team', 't', '--level', 'c9'],
  ]) {
    const result = await run(contract, argv, { transport })
    assert.equal(result.code, 2, `${argv.join(' ')} → ${result.stderr}`)
    assert.match(result.stderr, /^error: /)
  }
})

test('toSkillMarkdown describes every command', () => {
  const skill = toSkillMarkdown(contract, { bin: 'acme', description: 'Manage lessons: list, create, delete.' })
  assert.match(skill, /^---\nname: acme-cli\ndescription: "Manage lessons: list, create, delete\."\n---/)
  assert.match(skill, /### `acme songs set-offset <slug> --offset-ms <number> \[--loop\]`/)
  assert.match(skill, /\*\*Destructive\*\*: requires `--yes`/)
  assert.doesNotMatch(skill, /## Authentication/)
})

test('a paginated list prints a table of items and the command for the next page', async () => {
  const { collection, defineApi, defineConfig, implement, local } = await import('onedef')
  const { z } = await import('zod')
  const config = defineConfig({ name: 'pg' })
  const api = defineApi(config, {
    items: collection(config, {
      name: 'items',
      description: 'Items.',
      id: 'id',
      fields: z.object({ id: z.string(), n: z.number() }),
      list: { paginate: 'cursor' },
    }),
  })
  const rows = Array.from({ length: 5 }, (_, n) => ({ id: `i${n}`, n }))
  const backend = implement(api, {
    items: {
      list: ({ input }) => {
        const start = Number(input.cursor ?? 0)
        const end = start + (input.limit ?? 2)
        return { items: rows.slice(start, end), ...(end < rows.length ? { nextCursor: String(end) } : {}) }
      },
      get: ({ id }) => rows.find((r) => r.id === id)!,
    },
  })
  const first = await run(api, ['items', 'list', '--limit', '2'], { transport: local(backend) })
  assert.deepEqual(first.stdout.trim().split('\n'), ['ID  N', 'i0  0', 'i1  1'])
  assert.match(first.stderr, /More: pg items list --limit 2 --cursor 2/)
  const last = await run(api, ['items', 'list', '--cursor', '4'], { transport: local(backend) })
  assert.deepEqual(last.stdout.trim().split('\n'), ['ID  N', 'i4  4'])
  assert.equal(last.stderr, '')
})
