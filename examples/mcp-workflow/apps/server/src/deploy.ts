/**
 * Workflows that ask a human, as MCP forms.
 *
 * `deploy` builds, asks the user to approve with TanStack's own `ctx.approve`,
 * then ships. `release` builds, then asks the user to fill a form with
 * `ctx.elicitHumanInput` (MCP form elicitation: `message` and `requestedSchema`
 * in, `{ action, content }` out). Over MCP both are native elicitation forms.
 *
 * The difference from plain MCP elicitation is the build. With plain
 * elicitation, the client calls the tool again after the user answers, so
 * everything before the question runs again. Here the build is a recorded
 * step and the retried call replays the run, so the build runs once.
 * `DEPLOY_LOG` (a file path) records every build and ship, to see it happen.
 */
import { appendFileSync } from 'node:fs'
import { createWorkflow } from '@onedef/mcp-elicitation-workflow'
import { z } from 'zod'

let builds = 0
const log = (line: string) => {
  if (process.env.DEPLOY_LOG) appendFileSync(process.env.DEPLOY_LOG, `${new Date().toISOString()} ${line}\n`)
}
const buildApp = (name: string, env: string) => {
  builds++
  log(`workflow ${name}: BUILD ran (total ${builds}) env=${env}`)
  return { id: `build-${builds}`, env }
}

export const deploy = createWorkflow({
  id: 'deploy',
  description: 'Build the app and deploy it to an environment, after the user approves.',
  input: z.object({ env: z.string().describe('Where to deploy, e.g. staging') }),
}).handler(async (ctx) => {
  const build = await ctx.step('build', () => buildApp('deploy', ctx.input.env))

  const { approved, feedback } = await ctx.approve({
    title: `Deploy ${build.id} to ${build.env}?`,
    description: 'The build passed its checks.',
  })
  if (!approved) {
    log(`workflow deploy: not deployed (${feedback ?? 'rejected'})`)
    return { deployed: false, build: build.id, feedback }
  }

  await ctx.step('ship', () => log(`workflow deploy: SHIPPED ${build.id} to ${build.env}`))
  return { deployed: true, build: build.id, env: build.env, feedback }
})

export const release = createWorkflow({
  id: 'release',
  description: 'Build a release and publish it to a channel the user picks.',
  input: z.object({ version: z.string().describe('The version to release, e.g. 2.1.0') }),
}).handler(async (ctx) => {
  const build = await ctx.step('build', () => buildApp('release', ctx.input.version))

  const answer = await ctx.elicitHumanInput({
    message: `Publish ${ctx.input.version} (${build.id})?`,
    requestedSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['stable', 'beta'], title: 'Channel' },
        notes: { type: 'string', title: 'Release notes' },
      },
      required: ['channel'],
    },
  })
  if (answer.action !== 'accept') return { released: false, build: build.id, action: answer.action }

  await ctx.step('ship', () => log(`workflow release: SHIPPED ${build.id} to ${answer.content?.channel}`))
  return { released: true, build: build.id, ...answer.content }
})
