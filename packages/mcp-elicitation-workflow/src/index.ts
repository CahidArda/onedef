/**
 * Elicitation workflows: TanStack Workflow runs that stop to ask someone, and
 * pick up exactly where they stopped once answered.
 *
 *   import { createWorkflow } from '@onedef/mcp-elicitation-workflow'
 *
 *   createWorkflow({ id: 'deploy', input })
 *     .handler(async (ctx) => {
 *       const build = await ctx.step('build', () => buildApp())
 *       const { approved } = await ctx.approve({ title: `Deploy ${build.id}?` })   // a human: yes / no
 *       const form = await ctx.elicitHumanInput({ message, requestedSchema })           // a human: a form
 *       const notes = await ctx.elicitAgentInput('notes', { schema, instructions, data })       // the agent: some work
 *     })
 *
 * `createWorkflow` is TanStack Workflow's, with this package's middleware
 * applied. `ctx.step` and `ctx.approve` are TanStack's own; the middleware
 * (`mcpElicitation()`, for TanStack's own `createWorkflow`) adds `ctx.elicitHumanInput`,
 * which takes and returns what an MCP form elicitation does (`message` and
 * `requestedSchema` in, `{ action, content }` out), and `ctx.elicitAgentInput`.
 *
 * The difference is what happens around the question. In MCP's 2026-07-28
 * protocol a tool that elicits returns `input_required`, and the client calls
 * the tool again with the answer, so everything before the question runs again
 * (a build, a payment, a model call). Here the tool call carries the run id
 * as `requestState`, and the run replays: finished `ctx.step`s return what they
 * recorded instead of running, and the answer is delivered to the question
 * that was waiting. The run also survives restarts and other instances, since
 * it lives in the run store, not in a process.
 *
 *   const runs = workflowRuns(deploy, { runStore })
 *   await runs.start(input)          // { runId, status: 'waiting', waitingFor }
 *   await runs.next(runId, answer)   // the next state
 *
 * Advanced: `runs.start(input, { headless: true })` starts a run nobody will
 * answer (a backend job, onedef calling a process end to end). There,
 * `elicitHumanInput` returns `{ action: 'cancel' }`, `elicitAgentInput` fails the
 * run, and the workflow can branch on `ctx.headless` to do the work itself.
 *
 * Over MCP, `registerWorkflowTool()` (from `/mcp`) does all of this for you.
 * Keep the handler deterministic between `step` / `elicitAgentInput` / `elicitHumanInput` calls.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import {
  createMiddleware,
  createWorkflow as createTanStackWorkflow,
  runWorkflow,
  type AnyWorkflowDefinition,
  type CreateWorkflowConfig,
  type SchemaInput,
  type RunState as EngineRunState,
  type RunStore,
  type WorkflowInput,
  type WorkflowOutput,
} from '@tanstack/workflow-core'
import { kvRunStore, memoryKv } from './kv.js'

export { kvRunStore, type RunKv } from './kv.js'
// Re-exported, so using this package never means installing or importing TanStack Workflow.
export type { AnyWorkflowDefinition, RunStore, WorkflowDefinition } from '@tanstack/workflow-core'

export type JsonSchema = Record<string, unknown>

// --- what a driver sees --------------------------------------------------------

/** An open question for the agent driving the run (from `elicitAgentInput`). */
export interface AgentQuestion {
  kind: 'agent'
  /** Which `elicitAgentInput` this is, e.g. `section-2`. */
  name: string
  /** What to do, in words. */
  instructions?: string
  /** The material for this step. */
  data?: unknown
  /** JSON Schema the answer must match. */
  schema: JsonSchema
}

/** An open question for a human (from `elicitHumanInput`): MCP's form elicitation params. */
export interface HumanQuestion {
  kind: 'human'
  name: string
  message: string
  requestedSchema: JsonSchema
}

/** An open approval for a human (TanStack's `ctx.approve`). Answer with `{ approved, feedback? }`. */
export interface ApprovalQuestion {
  kind: 'approval'
  /** The approval id. */
  name: string
  title: string
  description?: string
}

/** What `next` takes for an approval. */
export interface ApprovalAnswer {
  approved: boolean
  feedback?: string
}

export type Question = AgentQuestion | HumanQuestion | ApprovalQuestion

/** Where a run is, as `start` and `next` report it. */
export interface RunSnapshot<TOutput = unknown> {
  runId: string
  /** `waiting`: answer `waitingFor` with `next`. `done`: `output` is the result. `failed`: see `error`. */
  status: 'waiting' | 'done' | 'failed'
  waitingFor?: Question
  output?: TOutput
  error?: { message: string; code?: string }
}

/**
 * The errors drivers see. `INVALID_INPUT`: the answer was rejected and the run
 * did not move. `NOT_FOUND`: no such run. `NO_ANSWER` (inside a headless run):
 * `elicitAgentInput` was reached and nobody can answer it.
 */
export class RunError extends Error {
  override name = 'RunError'
  constructor(
    readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'NO_ANSWER',
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

// --- asking --------------------------------------------------------------------

/** The part of a TanStack workflow `ctx` that `elicitAgentInput` and `elicitHumanInput` use. */
export interface ElicitContext {
  runId: string
  step: <T>(id: string, fn: () => T | Promise<T>) => Promise<T>
  waitForEvent: <T = unknown>(name: string, options?: { id?: string; meta?: Record<string, unknown> }) => Promise<T>
}

// Whether a run is headless is part of its id, so every replay of it agrees.
const HEADLESS = 'headless_'

/**
 * True in a run started with `{ headless: true }`, which nobody will answer:
 * `elicitHumanInput` returns `{ action: 'cancel' }` and `elicitAgentInput` fails
 * the run. Branch on it to do the work yourself:
 *
 *   const outline = ctx.headless
 *     ? await ctx.step('outline', () => myModel.outline(topic))
 *     : await ctx.elicitAgentInput('outline', { schema, instructions, data })
 */
export const isHeadless = (ctx: { runId: string }): boolean => ctx.runId.startsWith(HEADLESS)

type Issue = { message: string; path?: unknown[] }
type Meta = (AgentQuestion | HumanQuestion) & { rejected?: Issue[] }

const issuesOf = (issues: readonly StandardSchemaV1.Issue[]): Issue[] =>
  issues.map((issue) => ({
    message: issue.message,
    ...(issue.path?.length
      ? { path: issue.path.map((p) => (typeof p === 'object' && p !== null ? (p as { key: unknown }).key : p)) }
      : {}),
  }))

const describeIssues = (issues: Issue[]) =>
  issues.map((issue) => (issue.path?.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)).join('; ')

/** JSON Schema of a Standard Schema, through Standard JSON Schema. */
export function jsonSchemaOf(schema: StandardSchemaV1): JsonSchema {
  const json = (schema['~standard'] as { jsonSchema?: { input: (o: { target: string }) => JsonSchema } }).jsonSchema
  if (!json) {
    throw new Error('mcp-elicitation-workflow: the schema has no JSON Schema support; use zod ≥ 4.2, valibot or arktype')
  }
  const { $schema: _drop, ...rest } = json.input({ target: 'draft-2020-12' })
  return rest
}

/**
 * Pause at `id` until an answer passes `check`. A rejected answer is another
 * wait at the same place (attempt n+1), so the run never advances on input
 * that does not fit; TanStack would record a payload first and validate after.
 */
async function waitForAnswer<T>(
  ctx: ElicitContext,
  id: string,
  question: AgentQuestion | HumanQuestion,
  check: (raw: unknown) => Promise<{ value: T } | { issues: Issue[] }>,
): Promise<T> {
  let rejected: Issue[] | undefined
  for (let attempt = 1; ; attempt++) {
    const meta: Meta = { ...question, ...(rejected ? { rejected } : {}) }
    const raw = await ctx.waitForEvent('answer', {
      id: attempt === 1 ? id : `${id}#${attempt}`,
      meta: meta as unknown as Record<string, unknown>,
    })
    const result = await check(raw)
    if ('value' in result) return result.value
    rejected = result.issues
  }
}

export interface AgentInputOptions<TSchema extends StandardSchemaV1> {
  /** What the answer must look like. Any Standard Schema with JSON Schema support (zod ≥ 4.2, valibot, arktype). */
  schema: TSchema
  /** What to do, in words — shown to the agent. */
  instructions?: string
  /** The material to work on — shown to the agent. Send shared context once, in the first question. */
  data?: unknown
}

/**
 * Ask the agent driving the run to do some work. The run pauses until `next`
 * delivers an answer that matches `schema`; a non-matching one is rejected with
 * the reason. In a headless run nobody can answer, so the run fails: branch on
 * `ctx.headless` to do the work another way.
 */
export async function elicitAgentInput<TSchema extends StandardSchemaV1>(
  ctx: ElicitContext,
  name: string,
  options: AgentInputOptions<TSchema>,
): Promise<StandardSchemaV1.InferOutput<TSchema>> {
  const { schema, instructions, data } = options
  const validate = async (raw: unknown) => {
    const result = await schema['~standard'].validate(raw)
    return result.issues ? { issues: issuesOf(result.issues) } : { value: result.value }
  }
  if (isHeadless(ctx)) {
    throw new RunError(
      'NO_ANSWER',
      `Nobody can answer "${name}": this run is headless. Branch on ctx.headless to do this work another way.`,
    )
  }
  const question: AgentQuestion = {
    kind: 'agent',
    name,
    ...(instructions ? { instructions } : {}),
    ...(data !== undefined ? { data } : {}),
    schema: jsonSchemaOf(schema),
  }
  return waitForAnswer(ctx, `ask:${name}`, question, validate) as Promise<StandardSchemaV1.InferOutput<TSchema>>
}

/** MCP's form elicitation params (`ElicitRequestFormParams`). */
export interface ElicitParams {
  mode?: 'form'
  /** What you are asking, shown to the user. */
  message: string
  /** A flat object schema of primitive fields: the form. */
  requestedSchema: JsonSchema
}

/** MCP's `ElicitResult`: what the user did with the form. */
export interface ElicitResult {
  action: 'accept' | 'decline' | 'cancel'
  /** The submitted fields, when `action` is `accept`. */
  content?: Record<string, string | number | boolean | string[]>
}

export interface ElicitOptions {
  /** A stable name for this question. Default: its position among the run's `elicitHumanInput` calls (`elicit-1`, …). */
  id?: string
}

const positions = new WeakMap<object, number>()

/** The user's answer: an action, and for `accept` the fields the form asked for. Content is not otherwise trusted. */
function checkElicitResult(schema: JsonSchema) {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
  return async (raw: unknown): Promise<{ value: ElicitResult } | { issues: Issue[] }> => {
    const result = raw as Partial<ElicitResult> | null
    if (!result || !['accept', 'decline', 'cancel'].includes(result.action as string)) {
      return { issues: [{ message: 'action must be accept, decline or cancel', path: ['action'] }] }
    }
    if (result.action !== 'accept') return { value: { action: result.action! } }
    const content = (result.content ?? {}) as Record<string, unknown>
    const missing = required.filter((key) => content[key] === undefined)
    if (missing.length) return { issues: missing.map((key) => ({ message: 'required', path: ['content', key] })) }
    return { value: { action: 'accept', content: content as ElicitResult['content'] } }
  }
}

/**
 * Ask a human: MCP form elicitation, inside a workflow, with the same params
 * and result as an `elicitation/create` request. The run pauses until the answer
 * arrives (over MCP: the client shows the form and calls the tool again), and
 * nothing before this call runs again. In a headless run there is nobody to
 * ask: the result is `{ action: 'cancel' }`, as from a client that cannot show
 * forms.
 */
export async function elicitHumanInput(
  ctx: ElicitContext,
  params: ElicitParams,
  options: ElicitOptions = {},
): Promise<ElicitResult> {
  const position = (positions.get(ctx) ?? 0) + 1
  positions.set(ctx, position)
  const name = options.id ?? `elicit-${position}`
  if (isHeadless(ctx)) return { action: 'cancel' }
  const question: HumanQuestion = {
    kind: 'human',
    name,
    message: params.message,
    requestedSchema: params.requestedSchema,
  }
  return waitForAnswer(ctx, `elicit:${name}`, question, checkElicitResult(params.requestedSchema))
}

// --- the ctx fields ----------------------------------------------------------

/** What `mcpElicitation()` adds to every workflow's `ctx`. */
export interface McpHumanInputContext {
  /** Ask a human to fill a form: MCP form elicitation, same params and result. */
  elicitHumanInput(params: ElicitParams, options?: ElicitOptions): Promise<ElicitResult>
  /** True in a run started with `{ headless: true }`, which nobody will answer. See `isHeadless`. */
  headless: boolean
}

/** What `mcpElicitation({ agentInput: true })` adds on top. */
export interface McpAgentInputContext {
  /** Ask the agent driving the run to do some work. */
  elicitAgentInput<TSchema extends StandardSchemaV1>(
    name: string,
    options: AgentInputOptions<TSchema>,
  ): Promise<StandardSchemaV1.InferOutput<TSchema>>
}

/**
 * The `ctx` fields a workflow gets. `ctx.elicitAgentInput` exists only with
 * `agentInput: true`, so calling it in a workflow that didn't opt in is a type
 * error, not a surprise at runtime.
 */
export type McpElicitationContext<TAgentInput extends boolean = false> = McpHumanInputContext &
  (TAgentInput extends true ? McpAgentInputContext : unknown)

export interface McpElicitationOptions<TAgentInput extends boolean = false> {
  /**
   * Whether this workflow asks the agent (`ctx.elicitAgentInput`). An MCP tool for
   * such a workflow needs a second tool, `<name>_next`, where the agent answers;
   * without it, one tool is enough. Default false.
   */
  agentInput?: TAgentInput
}

// Marks the middleware, so registerWorkflowTool can tell from a workflow
// definition whether it asks the agent.
const AGENT_INPUT = Symbol.for('onedef.mcpElicitation.agentInput')

/**
 * The middleware that gives a workflow `ctx.elicitHumanInput` and `ctx.headless`,
 * and with `agentInput: true`, `ctx.elicitAgentInput`. TanStack runs it on every
 * replay, so the methods are always bound to the current `ctx`.
 *
 *   createWorkflow({ id }).middleware([mcpElicitation()]).handler(async (ctx) => ctx.elicitHumanInput(…))
 */
export function mcpElicitation<const TAgentInput extends boolean = false>(
  options: McpElicitationOptions<TAgentInput> = {},
) {
  const agentInput = options.agentInput === true
  const middleware = createMiddleware().server<McpElicitationContext<TAgentInput>>(async ({ ctx, next }) => {
    const inner = ctx as unknown as ElicitContext
    const context = {
      elicitHumanInput: (params: ElicitParams, opts?: ElicitOptions) => elicitHumanInput(inner, params, opts),
      // Present at runtime either way, so plain JavaScript gets a clear error.
      elicitAgentInput: agentInput
        ? (name: string, opts: AgentInputOptions<StandardSchemaV1>) => elicitAgentInput(inner, name, opts)
        : () => {
            throw new Error(
              'ctx.elicitAgentInput needs `agentInput: true` on createWorkflow (or mcpElicitation({ agentInput: true })).',
            )
          },
      headless: isHeadless(inner),
    }
    // TanStack checks the fields against its reserved names; it cannot see through the conditional type.
    return next({ context: context as never })
  })
  return Object.assign(middleware, { [AGENT_INPUT]: agentInput })
}

/** Whether a workflow asks the agent, i.e. was built with `agentInput: true`. */
export function asksAgent(workflow: AnyWorkflowDefinition): boolean {
  return workflow.middlewares.some((m) => (m as { [AGENT_INPUT]?: boolean })[AGENT_INPUT] === true)
}

/**
 * TanStack Workflow's `createWorkflow`, with `mcpElicitation()` already applied:
 * `ctx.elicitHumanInput` and `ctx.headless` are there, next to TanStack's own
 * `ctx.step` and `ctx.approve`. Pass `agentInput: true` to also get
 * `ctx.elicitAgentInput`.
 *
 *   const deploy = createWorkflow({ id: 'deploy', input: z.object({ env: z.string() }) })
 *     .handler(async (ctx) => { … })
 *
 * The builder is TanStack's, so `.middleware([...])` adds more middleware.
 */
export function createWorkflow<
  TInputSchema extends SchemaInput | undefined = undefined,
  TOutputSchema extends SchemaInput | undefined = undefined,
  TStateSchema extends SchemaInput | undefined = undefined,
  const TAgentInput extends boolean = false,
>(config: CreateWorkflowConfig<TInputSchema, TOutputSchema, TStateSchema> & McpElicitationOptions<TAgentInput>) {
  const { agentInput, ...rest } = config
  return createTanStackWorkflow(rest as CreateWorkflowConfig<TInputSchema, TOutputSchema, TStateSchema>).middleware([
    mcpElicitation<TAgentInput>({ agentInput }),
  ])
}

// --- driving runs ------------------------------------------------------------

export interface StartOptions {
  /**
   * Advanced: nobody will answer this run (a backend job, onedef calling a
   * process end to end). `elicitHumanInput` returns `{ action: 'cancel' }`,
   * `elicitAgentInput` fails the run, `ctx.headless` is true. Default false.
   */
  headless?: boolean
}

export interface WorkflowRuns<TInput, TOutput> {
  /** Start a run, and drive it to its first question (or the end). */
  start(input: TInput, options?: StartOptions): Promise<RunSnapshot<TOutput>>
  /** Answer the run's current question (no answer: report where it is). */
  next(runId: string, answer?: unknown): Promise<RunSnapshot<TOutput>>
}

export interface WorkflowRunsOptions {
  /** Where runs live between calls. `memoryRunStore()` for tests; `kvRunStore(store)` or `redisRunStore(redis)` to deploy. */
  runStore: RunStore
}

/** Runs in process memory: tests and a single long-lived server. Serverless calls do not share it. */
export function memoryRunStore(): RunStore {
  return kvRunStore(memoryKv())
}

const snapshot = <TOutput>(state: EngineRunState): RunSnapshot<TOutput> => {
  if (state.status === 'finished') return { runId: state.runId, status: 'done', output: state.output as TOutput }
  if (state.status === 'paused' && state.pendingApproval) {
    const { approvalId, title, description } = state.pendingApproval
    return {
      runId: state.runId,
      status: 'waiting',
      waitingFor: { kind: 'approval', name: approvalId, title, ...(description ? { description } : {}) },
    }
  }
  if (state.status === 'paused' && state.waitingFor) {
    const { rejected: _rejected, ...question } = (state.waitingFor.meta ?? {}) as unknown as Meta
    return { runId: state.runId, status: 'waiting', waitingFor: question }
  }
  const error = state.error as { message?: string; name?: string } | undefined
  return {
    runId: state.runId,
    status: 'failed',
    error: {
      message: error?.message ?? `run ended as ${state.status}`,
      ...(error?.name && error.name !== 'Error' ? { code: error.name } : {}),
    },
  }
}

/** Drive runs of `workflow`: `start` / `next` for whoever answers its questions, `run` end to end. */
export function workflowRuns<TWorkflow extends AnyWorkflowDefinition>(
  workflow: TWorkflow,
  options: WorkflowRunsOptions,
): WorkflowRuns<WorkflowInput<TWorkflow>, WorkflowOutput<TWorkflow>> {
  type Out = WorkflowOutput<TWorkflow>
  const { runStore } = options
  const drive = async (args: object) => {
    for await (const _ of runWorkflow({ workflow, runStore, telemetry: false, ...args })) {
      // consuming the events drives the run; their effects land in the store
    }
  }
  const load = async (runId: string) => {
    const state = await runStore.getRunState(runId)
    if (!state || state.workflowId !== workflow.id) {
      throw new RunError('NOT_FOUND', `No ${workflow.id} run "${runId}". Start one first.`)
    }
    return state
  }
  return {
    async start(input, startOptions = {}) {
      const runId = `${startOptions.headless ? HEADLESS : 'run_'}${crypto.randomUUID()}`
      // TanStack reads a missing input as "not a start", so a run without one starts with null
      await drive({ runId, input: input ?? null })
      return snapshot<Out>(await load(runId))
    },
    async next(runId, answer) {
      const current = await load(runId)
      const before = snapshot<Out>(current)
      if (answer === undefined || before.status !== 'waiting') return before
      if (current.pendingApproval) {
        // TanStack's own approval: delivered as an approval, checked here first
        const { approved, feedback } = (answer ?? {}) as Partial<ApprovalAnswer>
        if (typeof approved !== 'boolean' || (feedback !== undefined && typeof feedback !== 'string')) {
          throw new RunError(
            'INVALID_INPUT',
            `Answer to approval "${current.pendingApproval.title}" rejected, the run did not move: send { approved: boolean, feedback?: string }.`,
          )
        }
        await drive({
          runId,
          approval: {
            approvalId: current.pendingApproval.approvalId,
            approved,
            ...(feedback !== undefined ? { feedback } : {}),
          },
        })
        return snapshot<Out>(await load(runId))
      }
      await drive({
        runId,
        signalDelivery: {
          signalId: crypto.randomUUID(),
          ...(current.waitingFor!.stepId ? { stepId: current.waitingFor!.stepId } : {}),
          name: 'answer',
          payload: answer,
        },
      })
      const after = await load(runId)
      const rejected = (after.waitingFor?.meta as unknown as Meta | undefined)?.rejected
      if (after.status === 'paused' && rejected && after.waitingFor?.stepId !== current.waitingFor!.stepId) {
        throw new RunError(
          'INVALID_INPUT',
          `Answer to "${before.waitingFor!.name}" rejected, the run did not move: ${describeIssues(rejected)}. ` +
            (before.waitingFor!.kind === 'agent'
              ? 'Send a corrected payload matching waitingFor.schema.'
              : 'Send an elicitation result ({ action, content }) matching waitingFor.requestedSchema.'),
          { issues: rejected },
        )
      }
      return snapshot<Out>(after)
    },
  }
}
