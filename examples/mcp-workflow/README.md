# mcp-workflow: a workflow an agent drives, as an MCP tool

A plain [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) server with one
[TanStack Workflow](https://tanstack.com/workflow) on it, turned into tools by
`@onedef/mcp-elicitation-workflow`. The connected agent does the work itself, one step at a time; the
server keeps the run.

```
apps/server   the MCP server: src/guide.ts (the workflow), src/server.ts (the tools)
apps/agent    an eve agent that drives it, and the eval CI runs
```

## The workflows

`src/guide.ts`: the agent writes a guide, section by section.

```ts
import { createWorkflow } from '@onedef/mcp-elicitation-workflow'

export const writeGuide = createWorkflow({
  id: 'write-guide',
  description: 'Write a short guide on a topic, section by section.',
  input: z.object({ topic: z.string() }),
}).handler(async (ctx) => {
  const plan = await ctx.elicitAgentInput('plan', {
    schema: z.object({ sections: z.array(z.string()).min(2).max(4) }),
    instructions: 'Propose 2 to 4 section titles for the topic.',
    data: { topic: ctx.input.topic },
  })
  // … one elicitAgentInput per section, then a review …
  return ctx.step('publish', () => publish(guide))
})
```

With an agent driving, the run pauses at each `ctx.elicitAgentInput` until the agent answers. The answer
is checked against `schema` inside the run, so a wrong one is sent back with the reason and
the run stays where it was.

`src/deploy.ts`: two workflows that ask the user, as native MCP forms.
- `deploy` builds, then asks for approval with TanStack's `ctx.approve`.
- `release` builds, then asks for a channel and notes with `ctx.elicitHumanInput`.

## The server

```ts
const server = new McpServer({ name: 'guides', version: '1.0.0' })
registerWorkflowTool(server, 'write_guide', { runStore }, writeGuide)   // write_guide, write_guide_next
registerWorkflowTool(server, 'deploy', { runStore }, deploy)            // deploy
registerWorkflowTool(server, 'release', { runStore }, release)          // release
```

`writeGuide` asks the agent (`agentInput: true`), so it also gets `write_guide_next`, where the
agent sends its answers. `deploy` and `release` only ask the user, so each is one tool.

The tools' descriptions explain the protocol to the agent. Runs live in `runStore`: in memory
locally, or Upstash Redis when `UPSTASH_REDIS_REST_URL` / `_TOKEN` are set. A serverless deploy
needs Redis, because each call may land on another instance.

```bash
pnpm --filter @example/workflow-server start    # http://localhost:3333/mcp
```

Add it to Claude as a custom connector (or any MCP client) and ask for a guide.

## Asking the user: `deploy` and `release`

`demo/compare.sh` uses Claude Code, with an Elicitation hook that answers each form. It
deploys once through `demo/plain-deploy.ts` (the MCP SDK's own pattern) and once through
`deploy` (`ctx.approve`), then releases once through `release` (`ctx.elicitHumanInput`):

```
plain deploy: BUILD ran (total 1)
USER asked: Deploy build-1 to staging? fields=["confirm"]
plain deploy: BUILD ran (total 2)
plain deploy: SHIPPED build-2 to staging        ← not the build the user confirmed
workflow deploy: BUILD ran (total 1)
USER asked: Deploy build-1 to staging? fields=["approved","feedback"]
workflow deploy: SHIPPED build-1 to staging
workflow release: BUILD ran (total 2)
USER asked: Publish 2.1.0 (build-2)? fields=["channel","notes"]
workflow release: SHIPPED build-2 to beta

builds per run: plain deploy 2, workflow deploy (ctx.approve) 1, workflow release (ctx.elicitHumanInput) 1
```

With plain elicitation, Claude Code (protocol 2026-07-28) calls the tool again with the
answer, so the build runs again. The workflow replays from its run store instead.

## Tests and evals

| | what it checks | needs |
| --- | --- | --- |
| `apps/server`: `pnpm test` | a scripted agent drives a run over Streamable HTTP; a wrong answer is sent back; runs survive across connections; the same workflow runs end to end | nothing |
| `apps/agent`: `pnpm eval` | an eve agent (scripted `mockModel`) drives the workflow through eve's MCP connection to `done` | Node 24 |

CI (`.github/workflows/ci.yml`) runs both on every push. Neither needs an API key.
