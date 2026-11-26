# mcp-workflow: a workflow an agent drives, as an MCP tool

A plain [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) server with
[TanStack Workflow](https://tanstack.com/workflow) workflows on it, turned into tools by
`@onedef/mcp-elicitation-workflow`. The agent writes a guide step by step, the user approves
a deploy and fills in a release form, and no step runs twice. No onedef contract involved.

```
server/          the MCP server on :3333
  src/guide.ts     write-guide: the agent answers each step (ctx.elicitAgentInput)
  src/deploy.ts    deploy and release: the user answers (ctx.approve, ctx.elicitHumanInput)
  src/server.ts    the tools: registerWorkflowTool(server, name, { runStore }, workflow)
  test/            a scripted agent drives a run over Streamable HTTP
  demo/            compare.sh: plain MCP elicitation vs the workflow, through Claude Code
agent/           an eve agent with a scripted model, and the eval CI runs
```

Packages: `@example/mcp-workflow-server`, `@example/mcp-workflow-agent`.

## Run it

From the repo root:

```bash
pnpm install && pnpm build                          # once: builds the onedef packages
pnpm --filter @example/mcp-workflow-server start    # http://localhost:3333/mcp
```

From this folder: `cd server && pnpm start`.

Runs live in memory, or in Upstash Redis when `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are set. A serverless deploy needs Redis, since each call may land
on another instance.

## Try it

```bash
claude mcp add --transport http guides http://localhost:3333/mcp
# > Write a short guide on caching with the guides tools.
# > Deploy to staging.
```

Or open the [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
(`npx @modelcontextprotocol/inspector`) on `http://localhost:3333/mcp`: call `write_guide`
with `{ "topic": "caching" }`, then answer each step with `write_guide_next`.

| tool | asks | what happens |
| --- | --- | --- |
| `write_guide`, `write_guide_next` | the agent | each step returns `runId` + `waitingFor` (instructions, data, JSON Schema); a wrong answer is sent back with the reason and the run stays put |
| `deploy` | the user | builds, then asks for approval with a native MCP form; the build runs once |
| `release` | the user | builds, then asks for a channel and notes |

## Tests and evals

| command | what it checks | needs |
| --- | --- | --- |
| `pnpm --filter @example/mcp-workflow-server test` | the tool list (`_next` only where the agent answers); a scripted agent drives a run, and a wrong answer is sent back; runs survive across connections | nothing |
| `pnpm --filter @example/mcp-workflow-agent eval` | an eve agent (scripted `mockModel`) drives the workflow through eve's MCP connection to `done` | Node 24 |
| `server/demo/compare.sh` | deploys through plain MCP elicitation and through the workflow with Claude Code, and counts the builds | `claude` (logged in), `jq` |

CI runs the first two on every push. Neither needs an API key.

`compare.sh` shows the point of the package: with plain elicitation, Claude Code calls the
tool again with the answer, so the build runs twice and ships a build the user never saw.
The workflow replays from its run store instead:

```
plain deploy: BUILD ran (total 1)
USER asked: Deploy build-1 to staging? fields=["confirm"]
plain deploy: BUILD ran (total 2)
plain deploy: SHIPPED build-2 to staging        ← not the build the user confirmed
workflow deploy: BUILD ran (total 1)
USER asked: Deploy build-1 to staging? fields=["approved","feedback"]
workflow deploy: SHIPPED build-1 to staging
```

## Docs

- [Elicitation workflow](https://onedef.cahidarda.com/docs/mcp-elicitation-workflow) ·
  [Asking the agent](https://onedef.cahidarda.com/docs/mcp-elicitation-workflow/asking-the-agent) ·
  [Asking a human](https://onedef.cahidarda.com/docs/mcp-elicitation-workflow/asking-a-human) ·
  [Run stores](https://onedef.cahidarda.com/docs/mcp-elicitation-workflow/run-stores)
- [Processes](https://onedef.cahidarda.com/docs/guides/processes): the same engine behind `process: true` in a onedef contract
- [All examples](https://onedef.cahidarda.com/docs/examples)
