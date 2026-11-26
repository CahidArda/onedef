# @onedef/mcp-elicitation-workflow

Long-running MCP tools that stop to ask someone, and continue exactly where they
stopped. A workflow can ask:

| | on `ctx` | over MCP |
| --- | --- | --- |
| the user | `ctx.elicitHumanInput({ message, requestedSchema })`, the params and result of an MCP form elicitation | a native elicitation form |
| the agent driving the run | `ctx.elicitAgentInput(name, { schema, instructions, data })` | the run's state; the agent answers with `<name>_next` |

Built on [TanStack Workflow](https://tanstack.com/workflow), and re-exports what you need
from it, so there's nothing else to install. It needs no onedef. It plugs into any MCP SDK
`McpServer`.

## Why

In MCP's 2026-07-28 protocol, a tool that elicits returns `input_required`. The client
asks the user, then **calls the tool again** with the answer. So everything before the
question runs again:

```ts
server.registerTool('deploy', …, async ({ env }, ctx) => {
  const build = await buildApp()                       // runs on the first call AND on the retry
  const answer = acceptedContent(ctx.mcpReq.inputResponses, 'confirm')
  if (!answer) return inputRequired({ inputRequests: { confirm: inputRequired.elicit({ … }) } })
  return ship(build)                                   // ships the second build, not the one the user saw
})
```

As an elicitation workflow, the build runs once. The retried call carries the run id as
`requestState`, and the run replays: finished steps return their recorded result instead of
running again.

```ts
import { createWorkflow } from '@onedef/mcp-elicitation-workflow'
import { registerWorkflowTool } from '@onedef/mcp-elicitation-workflow/mcp'

const release = createWorkflow({ id: 'release', description: 'Build and publish a release.', input: z.object({ version: z.string() }) })
  .handler(async (ctx) => {
    const build = await ctx.step('build', () => buildApp())                  // once
    const answer = await ctx.elicitHumanInput({                               // a form, shown by the MCP client
      message: `Publish ${build.id}?`,
      requestedSchema: { type: 'object', properties: { channel: { type: 'string', enum: ['stable', 'beta'] } }, required: ['channel'] },
    })
    if (answer.action !== 'accept') return { released: false }
    return ctx.step('ship', () => ship(build, answer.content?.channel))
  })

// like server.registerTool(name, config, handler), with the workflow as the handler
registerWorkflowTool(server, 'release', { runStore }, release)
```

Measured with Claude Code, with a hook answering each form
([`examples/mcp-workflow/server/demo`](../../examples/mcp-workflow/server/demo)):

```
plain deploy: BUILD ran (total 1)
USER asked: Deploy build-1 to staging? fields=["confirm"]
plain deploy: BUILD ran (total 2)
plain deploy: SHIPPED build-2 to staging              ← not the build the user approved
workflow deploy: BUILD ran (total 1)
USER asked: Deploy build-1 to staging? fields=["approved","feedback"]
workflow deploy: SHIPPED build-1 to staging
workflow release: BUILD ran (total 2)
USER asked: Publish 2.1.0 (build-2)? fields=["channel","notes"]
workflow release: SHIPPED build-2 to beta
```

Runs also survive restarts and serverless instances, because a run lives in the run store
(`memoryRunStore()`, `kvRunStore(store)`, or `redisRunStore(redis)` from `/redis`), not in a
process.

## Asking the agent

A workflow that asks the agent says so with `agentInput: true`. Without it,
`ctx.elicitAgentInput` doesn't exist (a type error), and the workflow registers as one tool.

```ts
const writeGuide = createWorkflow({ id: 'write-guide', input, agentInput: true }).handler(async (ctx) => {
  const outline = await ctx.elicitAgentInput('outline', {
    schema: z.object({ sections: z.array(z.string()).min(2) }),
    instructions: 'Propose section titles for the guide.',
    data: { topic: ctx.input.topic },
  })
  // …
})
```

The tool returns the run's state with `waitingFor`. The agent sends its answer to
`<name>_next`, the second tool registered for such a workflow. A wrong answer is rejected
with the reason (`INVALID_INPUT`), and the run stays where it was.

## Without MCP

MCP is one driver. Anything can drive a run: a web form, a Slack button, a CLI, a queue.

```ts
const runs = workflowRuns(release, { runStore })
const state = await runs.start({ version: '2.1.0' })
// state.waitingFor: { kind: 'human', message, requestedSchema }   (or kind 'approval' / 'agent')
await runs.next(state.runId, { action: 'accept', content: { channel: 'beta' } })   // a form answer
await runs.next(runId, { approved: true, feedback: 'go' })                          // an approval answer
```

## Advanced: headless runs

A run that nobody will answer: a backend job, a test, onedef calling a process end to end.
MCP servers don't need this, because an MCP client can always answer.

```ts
await runs.start(input, { headless: true })
```

In a headless run:

| | result |
| --- | --- |
| `ctx.elicitHumanInput` | `{ action: 'cancel' }`, as from a client that cannot show forms |
| `ctx.elicitAgentInput` | the run fails: nobody can answer it |
| `ctx.approve` | waits as usual; `start` returns `status: 'waiting'`, and `next` can still answer it |

To finish anyway, branch on `ctx.headless` and do the agent's work yourself:

```ts
const outline = ctx.headless
  ? await ctx.step('outline', () => myModel.outline(ctx.input.topic))
  : await ctx.elicitAgentInput('outline', { schema, instructions, data })
```

## Notes

- **Older clients:** on 2025-era connections, the MCP SDK's legacy shim turns
  `input_required` into an `elicitation/create` request. The workflow is unchanged.
- **The run id:** it is random and unguessable, and it travels as `requestState`. To bind
  it to a caller as well, configure the SDK's `requestState` codec.
- **Determinism:** keep handlers deterministic between `step`, `approve`, `elicitHumanInput`
  and `elicitAgentInput` calls. Anything with side effects goes in a `step`.
- **Yes-or-no approvals:** TanStack's own `ctx.approve({ title })` also works. Over MCP it is
  a form with an Approve checkbox and optional feedback.
- **Already using TanStack Workflow directly?** Add the questions to its `createWorkflow`
  with the middleware:

  ```ts
  import { createWorkflow } from '@tanstack/workflow-core'          // TanStack's own
  import { mcpElicitation } from '@onedef/mcp-elicitation-workflow'

  createWorkflow({ id: 'deploy' }).middleware([mcpElicitation()]).handler(async (ctx) => { … })
  ```

  `mcpElicitation({ agentInput: true })` adds `ctx.elicitAgentInput` too.

  `elicitHumanInput(ctx, params)` and `elicitAgentInput(ctx, name, options)` are also
  exported as plain functions.
