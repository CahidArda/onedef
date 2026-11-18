/**
 * An elicitation workflow as a tool on your own `McpServer`, registered the
 * way `server.registerTool(name, config, handler)` registers one, with the
 * workflow in place of the handler:
 *
 *   registerWorkflowTool(server, 'deploy', { description, inputSchema, runStore }, deploy)
 *   // → deploy (starts a run); and, for a workflow with `agentInput: true`,
 *   //   deploy_next ({ runId, payload }, for answers from the agent)
 *
 * Questions reach whoever they are for:
 *
 * - `ctx.approve` / `ctx.elicitHumanInput` (a human): the tool returns MCP's `input_required` with the
 *   form and the run id as `requestState` (protocol 2026-07-28). The client
 *   shows the form and calls the same tool again with the answer; the run
 *   replays from the store, so the code before the question does not run
 *   again. Over 2025-era connections the SDK's legacy shim sends the form as
 *   an `elicitation/create` request and runs the same retry in process.
 * - `elicitAgentInput` (the agent): the tool returns the run's state; the agent does what
 *   `waitingFor` asks and sends the answer to `<name>_next`. A second tool,
 *   because MCP has no way for an agent to answer a tool mid-call. Only
 *   registered for a workflow that declares `agentInput: true`; a workflow
 *   that only asks the user is one tool, like any other.
 *
 * `description` and `inputSchema` default to the workflow's own (`createWorkflow({
 * description, input })`). The run id is a
 * random, unguessable capability, so it travels as `requestState` as is; to
 * bind it to a caller too, configure the SDK's `requestState` codec.
 */
import { inputRequired, type McpServer, type StandardSchemaWithJSON } from '@modelcontextprotocol/server'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { AnyWorkflowDefinition, RunStore } from '@tanstack/workflow-core'
import type { ToolAnnotations } from '@modelcontextprotocol/server'
import {
  asksAgent,
  jsonSchemaOf,
  RunError,
  workflowRuns,
  type ApprovalAnswer,
  type ElicitResult,
  type JsonSchema,
  type RunSnapshot,
} from './index.js'

/** How TanStack's `ctx.approve` is shown: a native form with a yes/no and room for feedback. */
const APPROVAL_FORM: JsonSchema = {
  type: 'object',
  properties: {
    approved: { type: 'boolean', title: 'Approve' },
    feedback: { type: 'string', title: 'Feedback (optional)' },
  },
  required: ['approved'],
}

/** The user's form answer, as an approval. Declining or dismissing the form does not approve. */
const toApproval = (result: unknown): ApprovalAnswer | undefined => {
  const answer = result as Partial<ElicitResult> | undefined
  if (!answer?.action) return undefined
  if (answer.action !== 'accept')
    return { approved: false, feedback: answer.action === 'decline' ? 'Declined' : 'Cancelled' }
  const { approved, feedback } = (answer.content ?? {}) as { approved?: unknown; feedback?: unknown }
  return { approved: approved === true, ...(typeof feedback === 'string' && feedback ? { feedback } : {}) }
}

/** `registerTool`'s config, plus where runs live. */
export interface WorkflowToolConfig {
  /** Where runs wait between calls: `memoryRunStore()`, `kvRunStore(store)`, `redisRunStore(redis)`. */
  runStore: RunStore
  title?: string
  /** What the tool does, for the agent. Default: the workflow's `description`. */
  description?: string
  /** The tool's input. Default: the workflow's `input` schema. */
  inputSchema?: StandardSchemaV1
  annotations?: ToolAnnotations
}

/** A Standard Schema the SDK takes as is: no validation (the workflow validates), just its JSON Schema. */
const described = (schema: JsonSchema): StandardSchemaWithJSON<Record<string, unknown>> => ({
  '~standard': {
    version: 1,
    vendor: 'mcp-elicitation-workflow',
    validate: (value) => ({ value: value as Record<string, unknown> }),
    jsonSchema: { input: () => schema, output: () => schema },
  },
})

const STATE: JsonSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string' },
    status: { type: 'string', enum: ['waiting', 'done', 'failed'] },
    waitingFor: {
      type: 'object',
      description: 'Present while waiting: what the run needs from you next.',
      properties: {
        kind: { type: 'string', enum: ['agent'] },
        name: { type: 'string' },
        instructions: { type: 'string' },
        data: { description: 'The material for this step.' },
        schema: { type: 'object', description: 'JSON Schema your payload must match.' },
      },
      required: ['name'],
    },
    output: { description: 'The result, once status is done.' },
    error: { type: 'object', properties: { message: { type: 'string' }, code: { type: 'string' } } },
  },
  required: ['runId', 'status'],
}

const NEXT_INPUT: JsonSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string', description: 'The run, from start.' },
    payload: {
      description: 'Your answer to waitingFor, matching waitingFor.schema. Omit to get the current step again.',
    },
  },
  required: ['runId'],
}

const failed = (error: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: error instanceof RunError ? `${error.code}: ${error.message}` : String((error as Error)?.message ?? error),
    },
  ],
  isError: true,
})

/** The tool result for a snapshot: a form for a human, the state for the agent. */
function reply(state: RunSnapshot) {
  if (state.status === 'waiting' && state.waitingFor?.kind === 'approval') {
    const { name, title, description } = state.waitingFor
    return inputRequired({
      inputRequests: {
        [name]: inputRequired.elicit({
          message: description ? `${title}\n\n${description}` : title,
          requestedSchema: APPROVAL_FORM as never,
        }),
      },
      requestState: state.runId,
    })
  }
  if (state.status === 'waiting' && state.waitingFor?.kind === 'human') {
    const { name, message, requestedSchema } = state.waitingFor
    return inputRequired({
      inputRequests: { [name]: inputRequired.elicit({ message, requestedSchema: requestedSchema as never }) },
      requestState: state.runId,
    })
  }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(state) }],
    structuredContent: state as unknown as Record<string, unknown>,
  }
}

type ToolCtx = {
  mcpReq: { requestState?: () => unknown; inputResponses?: Record<string, unknown> }
}

/**
 * Register `workflow` as the tool `name` on an MCP SDK server, like
 * `server.registerTool(name, config, handler)` with the workflow as the
 * handler. For a workflow with `agentInput: true`, also registers `<name>_next`,
 * where the agent sends its answers to `ctx.elicitAgentInput`.
 */
export function registerWorkflowTool(
  server: McpServer,
  name: string,
  config: WorkflowToolConfig,
  workflow: AnyWorkflowDefinition,
): void {
  const runs = workflowRuns(workflow, { runStore: config.runStore })
  const what = config.description ?? workflow.description ?? `Run ${workflow.id}.`
  const input = config.inputSchema ?? workflow.inputSchema
  const inputJson: JsonSchema = input ? jsonSchemaOf(input) : { type: 'object', properties: {} }
  const agent = asksAgent(workflow)

  /**
   * A retried call (the client answered a form) carries the run id as
   * `requestState`: deliver the answer to the run's open question, whatever
   * the call's own arguments say. Without an answer (the client dropped it),
   * the same form is asked again.
   */
  const resume = async (ctx: ToolCtx): Promise<RunSnapshot | undefined> => {
    const runId = ctx.mcpReq.requestState?.()
    if (typeof runId !== 'string' || !runId) return undefined
    const current = await runs.next(runId)
    if (current.status !== 'waiting') return current
    const response = ctx.mcpReq.inputResponses?.[current.waitingFor!.name]
    if (current.waitingFor?.kind === 'approval') return runs.next(runId, toApproval(response))
    if (current.waitingFor?.kind === 'human') return runs.next(runId, response)
    return current
  }

  server.registerTool(
    name,
    {
      ...(config.title ? { title: config.title } : {}),
      ...(config.annotations ? { annotations: config.annotations } : {}),
      description: agent
        ? `${what} This starts a run and returns its \`runId\` and state. Questions for the user are asked ` +
          'directly. When `status` is `waiting`, the work is yours: do what `waitingFor` asks (its ' +
          `\`instructions\`, using its \`data\`) and send your answer as \`payload\` to ${name}_next with the ` +
          'same `runId`; repeat until `status` is `done` (the result is `output`).'
        : `${what} Questions for the user are asked directly; the result is \`output\`.`,
      inputSchema: described(inputJson),
      outputSchema: described(STATE),
    },
    async (args, ctx) => {
      try {
        const resumed = await resume(ctx as unknown as ToolCtx)
        if (resumed) return reply(resumed)
        if (!input) return reply(await runs.start(args ?? {}))
        const parsed = await input['~standard'].validate(args ?? {})
        if (parsed.issues) throw new RunError('INVALID_INPUT', parsed.issues.map((i) => i.message).join('; '))
        return reply(await runs.start(parsed.value))
      } catch (error) {
        return failed(error)
      }
    },
  )

  if (!agent) return

  server.registerTool(
    `${name}_next`,
    {
      title: `Continue ${name}`,
      description:
        `Send \`payload\`, your answer to the current \`waitingFor\` of run \`runId\` (from ${name}); it must ` +
        'match `waitingFor.schema`. Accepted: the run moves on and you get the next state. Rejected: an ' +
        'INVALID_INPUT error says why and the run stays where it was — fix the answer and send it again. ' +
        'Without `payload`, returns the current state.',
      inputSchema: described(NEXT_INPUT),
      outputSchema: described(STATE),
      annotations: { idempotentHint: true },
    },
    async (args, ctx) => {
      try {
        const resumed = await resume(ctx as unknown as ToolCtx)
        if (resumed) return reply(resumed)
        const { runId, payload } = (args ?? {}) as { runId?: unknown; payload?: unknown }
        if (typeof runId !== 'string' || !runId) throw new RunError('INVALID_INPUT', 'runId is required')
        return reply(await runs.next(runId, payload))
      } catch (error) {
        return failed(error)
      }
    },
  )
}
