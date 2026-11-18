import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { AnyOp, OpDef, Out, Schema } from './contract.js'
import { toJsonSchema, type JsonSchema } from './jsonschema.js'

/**
 * Processes: a mutation marked `process: true` whose handler may take many
 * steps, and which the caller can either run end to end or work through one
 * step at a time — the connected agent doing the work itself.
 *
 * In the contract a process is just that one flag. Every surface then sees
 * three ops: the mutation itself (runs end to end on the server, so the UI's
 * button is a normal mutation) and two derived ones an agent drives —
 * `<op>Start` and `<op>Next` (MCP `songs_translate_start` / `_next`). They are
 * derived here, in the contract, so clients, the CLI and an MCP server that
 * only forwards all know them and type them without seeing the handler.
 *
 * The engine is not in core: `implement()` takes a `runStore` (from
 * `@onedef/process`) when the contract has a process, and that is where runs
 * are kept and replayed.
 */

/** Where a run is, as `<op>Start` and `<op>Next` report it. */
export interface ProcessState<TOutput = unknown> {
  runId: string
  /** `waiting`: send `waitingFor`'s answer to next. `done`: `output` is the result. `failed`: see `error`. */
  status: 'waiting' | 'done' | 'failed'
  waitingFor?: {
    /** Which pause this is, e.g. `part-2`. */
    name: string
    /** What to do, in words. */
    instructions?: string
    /** What the process hands over for this step (the material to work on). */
    data?: unknown
    /** JSON Schema of the answer next accepts as `payload`. */
    schema?: JsonSchema
  }
  output?: TOutput
  error?: { message: string; code?: string }
}

export interface NextInput {
  runId: string
  /** The answer to the current `waitingFor`. Omit to be told the current step again. */
  payload?: unknown
}

/** What a process handler gets on top of a regular handler's arguments (from `@onedef/mcp-elicitation-workflow`). */
export interface ProcessTools {
  /**
   * True when the mutation itself was called (`songs.translate`): the run goes
   * end to end and nobody will answer, so `elicitAgentInput` would fail the
   * run. Branch on it to do that work yourself (e.g. call your model). False
   * when it was started with `<op>Start`, where the caller answers.
   */
  headless: boolean
  runId: string
  /** Run `fn` once; on replay, return what it returned. Side effects, I/O, randomness and the clock go here. */
  step<T>(name: string, fn: () => T | Promise<T>): Promise<T>
  /**
   * The process needs work done by whoever drives it. With an agent driving
   * (`<op>Start` / `<op>Next`), the run pauses here until an answer matching
   * `schema` arrives; a non-matching one is rejected with the reason and the
   * run waits again at the same place. In a headless run nobody can answer, so
   * the run fails: branch on `headless`. `data` and `instructions` are what the
   * agent sees in `waitingFor`.
   */
  elicitAgentInput<TSchema extends Schema>(
    name: string,
    options: {
      schema: TSchema
      instructions?: string
      data?: unknown
    },
  ): Promise<Out<TSchema>>
}

/** One process, as `implement()` hands it to the run store. */
export interface ProcessRun {
  /** `<service>.<op>` — a run of one process cannot be continued as another. */
  name: string
  /**
   * The handler. `recorded` is what the run was started with (input, member
   * id, loaded object): a later `next` call has only the run id, so these come
   * from the run, not from that call.
   */
  fn: (tools: ProcessTools, recorded: unknown) => Promise<unknown>
}

/**
 * Where runs live and how they are replayed — what `implement({ runStore })`
 * takes. Build one with `@onedef/process` (`runsIn(store)`, `memoryRunStore()`).
 */
export interface RunStore {
  /** Start a run (`<op>Start`) and drive it to its first question (or the end). */
  start(process: ProcessRun, recorded: unknown): Promise<ProcessState>
  /** Deliver `payload` to the run's current pause (none: just report the state). */
  next(process: ProcessRun, runId: string, payload: unknown): Promise<ProcessState>
  /** Calling the mutation itself: a headless run, to the end; its output, or its error (an ApiError keeps its code). */
  run(process: ProcessRun, recorded: unknown): Promise<unknown>
}

// --- derived ops ------------------------------------------------------------

/** A schema that validates with `validate` and describes itself as `json` — no validator library needed. */
function describeOnly<TValue>(
  json: () => JsonSchema,
  validate: (value: unknown) => StandardSchemaV1.Result<TValue> = (value) => ({ value: value as TValue }),
): StandardSchemaV1<TValue, TValue> {
  return {
    '~standard': {
      version: 1,
      vendor: 'onedef',
      validate,
      jsonSchema: { input: json, output: json },
    } as StandardSchemaV1.Props<TValue, TValue>,
  }
}

export type StateSchema<TOutput> = StandardSchemaV1<ProcessState<TOutput>, ProcessState<TOutput>>
export type NextInputSchema = StandardSchemaV1<NextInput, NextInput>

const nextInput: NextInputSchema = describeOnly<NextInput>(
  () => ({
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'The run, from start.' },
      payload: {
        description: 'Your answer to waitingFor, matching waitingFor.schema. Omit to get the current step again.',
      },
    },
    required: ['runId'],
  }),
  (value) => {
    const input = value as Partial<NextInput> | null
    if (!input || typeof input !== 'object' || typeof input.runId !== 'string' || !input.runId) {
      return { issues: [{ message: 'runId is required', path: ['runId'] }] }
    }
    return { value: { runId: input.runId, ...(input.payload !== undefined ? { payload: input.payload } : {}) } }
  },
)

/** The state both derived ops return. Values come from the engine, so they pass as they are. */
const stateSchema = (output: Schema | undefined) =>
  describeOnly<ProcessState>(() => ({
    type: 'object',
    properties: {
      runId: { type: 'string' },
      status: { type: 'string', enum: ['waiting', 'done', 'failed'] },
      waitingFor: {
        type: 'object',
        description: 'Present while waiting: what the run needs from you next.',
        properties: {
          name: { type: 'string' },
          instructions: { type: 'string' },
          data: { description: 'The material for this step.' },
          schema: { type: 'object', description: 'JSON Schema your payload must match.' },
        },
        required: ['name'],
      },
      output: { ...(output ? toJsonSchema(output, 'output') : {}), description: 'The result, once status is done.' },
      error: { type: 'object', properties: { message: { type: 'string' }, code: { type: 'string' } } },
    },
    required: ['runId', 'status'],
  }))

type OnOf<TOp> = TOp extends { on: infer TOn extends 'collection' | 'member' } ? TOn : 'collection'
type InputOf<TOp> = TOp extends { input?: infer TInput } ? ([TInput] extends [Schema] ? TInput : undefined) : undefined
type ResultOf<TOp> = TOp extends { output?: infer TOutput }
  ? [TOutput] extends [Schema]
    ? Out<TOutput>
    : unknown
  : unknown

/** `<op>Start`: the process's own input (and member id); returns the run's state. */
export type StartOp<TOp> = OpDef<'mutation', OnOf<TOp>, InputOf<TOp>, StateSchema<ResultOf<TOp>>> & {
  processOf: { op: string; step: 'start' }
} & (TOp extends { needs: 'object' } ? { needs: 'object' } : {})

/** `<op>Next`: a run id and an answer; returns the run's state. */
export type NextOp<TOp> = OpDef<'mutation', 'collection', NextInputSchema, StateSchema<ResultOf<TOp>>> & {
  processOf: { op: string; step: 'next' }
}

type ProcessKeys<TOps> = { [K in keyof TOps]: TOps[K] extends { process: true } ? K : never }[keyof TOps] & string

/** The ops of a service with every process's `<op>Start` / `<op>Next` added. */
export type WithProcesses<TOps> = TOps & {
  [K in ProcessKeys<TOps> as `${K}Start`]: StartOp<TOps[K]>
} & {
  [K in ProcessKeys<TOps> as `${K}Next`]: NextOp<TOps[K]>
}

/** True when any op of any service is a process — `implement()` then requires a `runStore`. */
export type HasProcess<TServices> = true extends {
  [K in keyof TServices]: TServices[K] extends { ops: infer TOps }
    ? { [O in keyof TOps]: TOps[O] extends { process: true } ? true : false }[keyof TOps]
    : false
}[keyof TServices]
  ? true
  : false

const firstSentence = (text: string) => (/^[^.!?]*[.!?]?/.exec(text)?.[0] ?? text).trim()

/** Add the derived ops of every process in `ops`. Runs where services are declared. */
export function withProcesses<TOps extends Record<string, AnyOp>>(service: string, ops: TOps): WithProcesses<TOps> {
  const out: Record<string, AnyOp> = { ...ops }
  for (const [name, op] of Object.entries(ops)) {
    if (!op.process) continue
    if (op.kind !== 'mutation') throw new Error(`onedef: ${service}.${name} — only a mutation can be a process`)
    if (op.http) throw new Error(`onedef: ${service}.${name} — a process runs on your backend; it cannot have \`http\``)
    for (const derived of [`${name}Start`, `${name}Next`]) {
      if (ops[derived])
        throw new Error(`onedef: ${service}.${derived} clashes with the op derived from process "${name}"`)
    }
    const shared = {
      ...(op.scope ? { scope: op.scope } : {}),
      ...(op.modes ? { modes: op.modes } : {}),
      ...(op.affects ? { affects: op.affects } : {}),
    }
    const what = op.description ? ` ${op.description}` : ''
    out[`${name}Start`] = {
      kind: 'mutation',
      on: op.on,
      summary: `${op.summary.replace(/\.$/, '')} (you do the work, step by step)`,
      description:
        `${firstSentence(op.summary)}${what} Here you do the work: this starts a run and returns its \`runId\` ` +
        'and state. While `status` is `waiting`, do what `waitingFor` asks and send your answer as `payload` ' +
        `to ${name}Next with the same \`runId\`; repeat until \`status\` is \`done\` (the result is \`output\`). ` +
        'The first `waitingFor` carries the context for the whole run — later steps assume you have it.',
      ...(op.input ? { input: op.input } : {}),
      output: stateSchema(op.output),
      ...(op.needs ? { needs: op.needs } : {}),
      ...shared,
      processOf: { op: name, step: 'start' },
    } as AnyOp
    out[`${name}Next`] = {
      kind: 'mutation',
      on: 'collection',
      summary: `Continue a ${name} run: send your answer to the current step`,
      description:
        `Send \`payload\`, your answer to the current \`waitingFor\` of run \`runId\` (from ${name}Start); it ` +
        'must match `waitingFor.schema`. Accepted: the run moves on and you get the next state. Rejected: an ' +
        'INVALID_INPUT error says why and the run stays where it was — fix the answer and send it again. ' +
        'Without `payload`, returns the current state (to re-read a step).',
      input: nextInput,
      output: stateSchema(op.output),
      idempotent: true,
      ...shared,
      processOf: { op: name, step: 'next' },
    } as AnyOp
  }
  return out as WithProcesses<TOps>
}
