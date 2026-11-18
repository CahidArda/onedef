/**
 * The engine behind onedef processes (mutations marked `process: true`). It is
 * a thin layer over `@onedef/mcp-elicitation-workflow`, the generic TanStack Workflow
 * extension: a process handler becomes a workflow, its `elicitAgentInput` is that
 * package's `elicitAgentInput`, and runs are driven by its `workflowRuns`.
 *
 *   implement(contract, handlers, { runStore: runsIn(fsStore('.data')) })
 *
 * What this layer adds is onedef's error contract: an `ApiError` thrown in a
 * step reaches the caller with its code, status and data, although the engine
 * itself keeps only an error's name and message.
 */
import {
  RunError,
  workflowRuns,
  mcpElicitation,
  kvRunStore,
  memoryRunStore as memoryEngineStore,
  type RunSnapshot,
  type RunKv,
  type RunStore as EngineStore,
} from '@onedef/mcp-elicitation-workflow'
import { createWorkflow } from '@tanstack/workflow-core'
import { ApiError, isApiError, type ProcessRun, type ProcessState, type RunStore } from 'onedef'

export type { RunKv } from '@onedef/mcp-elicitation-workflow'
export type { ProcessState, ProcessTools, RunStore } from 'onedef'

export interface RunsOptions {
  /** The namespace runs are kept under. Default `_runs`. */
  namespace?: string
}

/**
 * Keep runs in a key-value store — any `@onedef/store` store (`fsStore`,
 * `redisStore`, `memoryStore`) or anything with the same four methods.
 */
export function runsIn(kv: RunKv, options: RunsOptions = {}): RunStore {
  return engine(kvRunStore(kv, options))
}

/** Runs in process memory: tests, and a single long-lived server. Serverless calls do not share it. */
export function memoryRunStore(): RunStore {
  return engine(memoryEngineStore())
}

/** Any TanStack Workflow run store, e.g. `redisRunStore` from `@onedef/mcp-elicitation-workflow/redis`. */
export function runsWith(store: EngineStore): RunStore {
  return engine(store)
}

// --- ApiErrors through the engine ----------------------------------------------

const FAILED = '__onedefFailed'
type Failure = { code: string; status: number; message: string; data?: unknown }
const asFailure = (error: ApiError) => ({
  [FAILED]: { code: error.code, status: error.status, message: error.message, data: error.data },
})
const failureIn = (value: unknown): Failure | undefined =>
  value && typeof value === 'object' && FAILED in value
    ? ((value as Record<string, Failure>)[FAILED] as Failure)
    : undefined
const rethrow = (failure: Failure): never => {
  throw new ApiError(failure.code, failure.message, { status: failure.status, data: failure.data })
}
const fromAgentError = (error: unknown): never => {
  if (error instanceof RunError) {
    throw new ApiError(error.code === 'NO_ANSWER' ? 'INTERNAL' : error.code, error.message, {
      ...(error.data !== undefined ? { data: error.data } : {}),
    })
  }
  throw error
}

function workflowOf(process: ProcessRun) {
  return createWorkflow({ id: process.name })
    .middleware([mcpElicitation({ agentInput: true })])
    .handler(async (ctx) => {
      try {
        return await process.fn(
          {
            headless: ctx.headless,
            runId: ctx.runId,
            async step(name, fn) {
              // recorded as the step's result, so replay rethrows the same ApiError
              const result = await ctx.step(`step:${name}`, async () => {
                try {
                  return await fn()
                } catch (error) {
                  if (!isApiError(error)) throw error
                  return asFailure(error)
                }
              })
              const failure = failureIn(result)
              return failure ? rethrow(failure) : (result as never)
            },
            elicitAgentInput: (name, options) => ctx.elicitAgentInput(name, options as never) as never,
          },
          ctx.input,
        )
      } catch (error) {
        // recorded as the run's outcome, so callers get the code back
        if (!isApiError(error)) throw error
        return asFailure(error)
      }
    })
}

const reported = (state: RunSnapshot): ProcessState => {
  const failure = state.status === 'done' ? failureIn(state.output) : undefined
  if (failure) return { runId: state.runId, status: 'failed', error: { message: failure.message, code: failure.code } }
  return state as ProcessState
}

function engine(store: EngineStore): RunStore {
  const runs = (process: ProcessRun) => workflowRuns(workflowOf(process), { runStore: store })
  return {
    async start(process, recorded) {
      const state = await runs(process).start(recorded).catch(fromAgentError)
      // Failed before its first pause (not signed in, no such song…): nothing
      // was started, so the caller gets the error itself, as from any op.
      const failure = state.status === 'done' ? failureIn(state.output) : undefined
      if (failure) {
        await store.deleteRun(state.runId, 'errored')
        rethrow(failure)
      }
      return reported(state)
    },
    async next(process, runId, payload) {
      return reported(await runs(process).next(runId, payload).catch(fromAgentError))
    },
    async run(process, recorded) {
      const state = await runs(process).start(recorded, { headless: true }).catch(fromAgentError)
      const failure = state.status === 'done' ? failureIn(state.output) : undefined
      if (failure) rethrow(failure)
      if (state.status === 'done') return state.output
      if (state.status === 'waiting') {
        throw new ApiError(
          'INTERNAL',
          `${process.name} waits for "${state.waitingFor?.name}", which nobody can answer when it is called directly`,
        )
      }
      throw new ApiError('INTERNAL', state.error?.message ?? `${process.name} failed`)
    },
  }
}
