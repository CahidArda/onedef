import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  action,
  collection,
  createClient,
  defineApi,
  defineConfig,
  defineService,
  fail,
  implement,
  local,
  mutation,
  toolName,
} from 'onedef'
import { z } from 'zod'
import { memoryRunStore, runsIn, type RunKv } from '../src/index.js'

// --- a process: translate lines in parts, by an agent or by "the model" -------

const config = defineConfig({ name: 'demo' })
const Translated = z.object({ lines: z.array(z.string()) })

const songs = defineService(config, {
  name: 'songs',
  description: 'Songs.',
  ops: {
    translate: mutation({
      summary: 'Translate a song',
      description: 'Each part arrives as a waitingFor.',
      input: z.object({ slug: z.string() }),
      output: z.object({ slug: z.string(), lines: z.array(z.string()) }),
      process: true,
    }),
  },
})
const contract = defineApi(config, { songs })

const lyrics: Record<string, string[]> = { tous: ['un', 'deux', 'trois'] }
const effects = { loads: 0, saves: 0 }

const handlers = {
  songs: {
    // one handler: the regular arguments plus step / elicitAgentInput / headless
    translate: async ({ input, step, elicitAgentInput, headless }) => {
      const lines = await step('load', () => {
        effects.loads++
        return lyrics[input.slug] ?? fail('NOT_FOUND', `No song "${input.slug}"`)
      })
      const parts = [lines.slice(0, 2), lines.slice(2)]
      const out: string[] = []
      for (const [i, part] of parts.entries()) {
        // the schema is built per part: exactly as many lines as were sent
        const schema = Translated.extend({ lines: z.array(z.string()).length(part.length) })
        const answer = headless
          ? // the mutation itself was called: nobody will answer, so "the model" does the work
            await step(`part-${i + 1}`, () => ({ lines: part.map((line) => `EN(${line})`) }))
          : await elicitAgentInput(`part-${i + 1}`, {
              schema,
              instructions: 'Translate these French lines into English, one per line.',
              // context once: only the first step carries the whole song
              data: i === 0 ? { song: lines, lines: part } : { lines: part },
            })
        out.push(...answer.lines)
      }
      await step('save', () => void effects.saves++)
      return { slug: input.slug, lines: out }
    },
  },
} satisfies Parameters<typeof implement<typeof contract.services, typeof config>>[1]

test('the contract derives translateStart / translateNext from one flag', () => {
  const { translateStart, translateNext } = contract.services.songs.ops
  assert.equal(toolName(contract, 'songs', 'translateStart'), 'songs_translate_start')
  assert.equal(toolName(contract, 'songs', 'translateNext'), 'songs_translate_next')
  assert.match(translateStart.summary, /^Translate a song \(you do the work/)
  assert.match(translateStart.description ?? '', /Each part arrives.*translateNext.*runId/)
  assert.match(translateNext.description ?? '', /INVALID_INPUT/)
})

test('an agent drives a run with start/next; a rejected answer does not move it', async () => {
  effects.loads = effects.saves = 0
  const runStore = memoryRunStore()
  // each call gets a fresh backend over the same store, as serverless invocations would
  const client = () => createClient(contract, local(implement(contract, handlers, { runStore })))

  const started = await client().songs.translateStart({ slug: 'tous' })
  assert.equal(started.status, 'waiting')
  assert.equal(started.waitingFor?.name, 'part-1')
  assert.deepEqual(started.waitingFor?.data, { song: ['un', 'deux', 'trois'], lines: ['un', 'deux'] })
  assert.equal(started.waitingFor?.schema?.type, 'object')
  const { runId } = started

  // no payload: the same step again
  assert.deepEqual(await client().songs.translateNext({ runId }), started)

  // wrong shape: rejected with the reason, the run stays at part-1
  await assert.rejects(client().songs.translateNext({ runId, payload: { lines: ['one'] } }), (error: any) => {
    assert.equal(error.code, 'INVALID_INPUT')
    assert.match(error.message, /part-1.*rejected.*did not move/)
    return true
  })
  assert.equal((await client().songs.translateNext({ runId })).waitingFor?.name, 'part-1')

  const second = await client().songs.translateNext({ runId, payload: { lines: ['one', 'two'] } })
  assert.deepEqual(second.waitingFor?.data, { lines: ['trois'] }, 'later steps do not repeat the context')

  const done = await client().songs.translateNext({ runId, payload: { lines: ['three'] } })
  assert.deepEqual(done, { runId, status: 'done', output: { slug: 'tous', lines: ['one', 'two', 'three'] } })
  assert.deepEqual(effects, { loads: 1, saves: 1 }, 'steps ran once across all the calls')

  // a finished run keeps answering with its result
  assert.equal((await client().songs.translateNext({ runId, payload: { lines: ['x'] } })).status, 'done')
  await assert.rejects(client().songs.translateNext({ runId: 'nope' }), (error: any) => error.code === 'NOT_FOUND')
})

test('calling the mutation itself runs the process end to end', async () => {
  effects.loads = effects.saves = 0
  const client = createClient(contract, local(implement(contract, handlers, { runStore: memoryRunStore() })))
  assert.deepEqual(await client.songs.translate({ slug: 'tous' }), {
    slug: 'tous',
    lines: ['EN(un)', 'EN(deux)', 'EN(trois)'],
  })
  assert.deepEqual(effects, { loads: 1, saves: 1 })
  // an ApiError thrown inside a step reaches the caller whole: same code, same status
  await assert.rejects(client.songs.translate({ slug: 'zz' }), (error: any) => {
    assert.equal(error.code, 'NOT_FOUND')
    assert.equal(error.status, 404)
    assert.match(error.message, /No song "zz"/)
    return true
  })
  // started by an agent instead, a run that fails before its first pause is just an error
  await assert.rejects(client.songs.translateStart({ slug: 'zz' }), (error: any) => error.code === 'NOT_FOUND')
})

test('elicitAgentInput in a headless run (the mutation itself) fails loudly instead of hanging', async () => {
  const backend = implement(
    contract,
    {
      songs: {
        translate: async ({ input, elicitAgentInput, headless }) => {
          assert.equal(headless, true)
          const answer = await elicitAgentInput('x', { schema: Translated })
          return { slug: input.slug, lines: answer.lines }
        },
      },
    },
    { runStore: memoryRunStore() },
  )
  await assert.rejects(
    createClient(contract, local(backend)).songs.translate({ slug: 'tous' }),
    /Nobody can answer "x": this run is headless/,
  )
})

test('runStore is required exactly when the contract has a process', () => {
  // @ts-expect-error — the contract has a process, so `runStore` is required
  assert.throws(() => implement(contract, handlers), /is a process; pass .*runStore/)

  const plain = defineApi(config, {
    notes: defineService(config, { name: 'notes', description: 'Notes.', ops: { add: mutation({ summary: 'Add' }) } }),
  })
  implement(plain, { notes: { add: async () => undefined } }) // no options needed
  // @ts-expect-error — a regular handler gets no process tools
  implement(plain, { notes: { add: async ({ step }) => step } })
})

test('a member action as a process: the object is loaded at start and recorded for the run', async () => {
  const Song = z.object({ slug: z.string(), lines: z.array(z.string()), english: z.array(z.string()).optional() })
  const catalog = collection(config, {
    name: 'catalog',
    description: 'Songs.',
    id: 'slug',
    fields: Song,
    actions: {
      translate: action({ summary: 'Translate it', needs: 'object', output: Song, process: true }),
    },
  })
  const api = defineApi(config, { catalog })
  const stored: Record<string, z.infer<typeof Song>> = { tous: { slug: 'tous', lines: ['un', 'deux'] } }
  let gets = 0
  const runStore = memoryRunStore()
  const backend = () =>
    implement(
      api,
      {
        catalog: {
          list: async () => Object.values(stored),
          get: async ({ id }) => (gets++, stored[id] ?? fail('NOT_FOUND', id)),
          translate: async ({ object, elicitAgentInput }) => {
            const answer = await elicitAgentInput('all', { schema: Translated, data: object.lines })
            return { ...object, english: answer.lines }
          },
        },
      },
      { runStore },
    )
  const start = await createClient(api, local(backend())).catalog.translateStart({ slug: 'tous' })
  assert.deepEqual(start.waitingFor?.data, ['un', 'deux'])
  const done = await createClient(api, local(backend())).catalog.translateNext({
    runId: start.runId,
    payload: { lines: ['one', 'two'] },
  })
  assert.deepEqual(done.output, { slug: 'tous', lines: ['un', 'deux'], english: ['one', 'two'] })
  assert.equal(gets, 1, 'next replays with the recorded object; it does not load it again')
})

test('runsIn keeps runs in any key-value store; a racing append conflicts', async () => {
  const data = new Map<string, unknown>()
  const kv: RunKv = {
    get: async (ns, id) => data.get(`${ns}|${id}`) as never,
    put: async (ns, id, value, options) => {
      if (options?.ifAbsent && data.has(`${ns}|${id}`)) return false
      data.set(`${ns}|${id}`, structuredClone(value))
      return true
    },
    delete: async (ns, id) => data.delete(`${ns}|${id}`),
    list: async (ns) => ({
      items: [...data.keys()]
        .filter((key) => key.startsWith(`${ns}|`))
        .sort()
        .map((key) => data.get(key) as never),
    }),
  }
  const client = createClient(contract, local(implement(contract, handlers, { runStore: runsIn(kv) })))
  const { runId } = await client.songs.translateStart({ slug: 'tous' })
  assert.ok(data.has(`_runs|${runId}`), 'state under <ns>/<runId>')
  assert.ok(data.has(`_runs/${runId}|000000000`), 'events under <ns>/<runId>/<index>')
  const done = await (async () => {
    await client.songs.translateNext({ runId, payload: { lines: ['one', 'two'] } })
    return client.songs.translateNext({ runId, payload: { lines: ['three'] } })
  })()
  assert.equal(done.status, 'done')
})
