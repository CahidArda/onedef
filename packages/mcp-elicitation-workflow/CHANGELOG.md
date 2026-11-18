# @onedef/mcp-elicitation-workflow

## 0.2.0

### Minor Changes

- [#10](https://github.com/CahidArda/onedef/pull/10) [`179ce32`](https://github.com/CahidArda/onedef/commit/179ce32016bb9301e6166548f6d3a8df756d441a) Thanks [@CahidArda](https://github.com/CahidArda)! - `agentInput` on `createWorkflow` (and `mcpElicitation({ agentInput })`), default `false`.

  A workflow that only asks the user now registers as one MCP tool. Only a workflow with `agentInput: true` gets `ctx.elicitAgentInput` and the second tool, `<name>_next`, where the agent sends its answers. Without the flag, calling `ctx.elicitAgentInput` is a type error (and a clear error at runtime in plain JavaScript).

  Breaking: workflows that call `ctx.elicitAgentInput` must add `agentInput: true`. `asksAgent(workflow)` reports the flag. `@onedef/process` opts in for its processes, so onedef's `process: true` mutations are unchanged.

## 0.1.0

First release.
