/**
 * The workflow: write a short guide on a topic. `createWorkflow` is TanStack
 * Workflow's, with the questions added; the agent's turns are the
 * `ctx.elicitAgentInput` calls. Plan the sections, write each one, then review
 * the whole guide. Every answer is checked against its schema inside the run,
 * so a wrong one is sent back with the reason.
 */
import { createWorkflow } from '@onedef/mcp-elicitation-workflow'
import { z } from 'zod'

const Plan = z.object({
  sections: z
    .array(z.string().min(3).describe('A section title'))
    .min(2)
    .max(4)
    .describe('2 to 4 section titles, in reading order'),
})
const Section = z.object({ body: z.string().min(40).describe('The section, 2 to 4 sentences') })
const Review = z.object({
  summary: z.string().min(20).describe('One or two sentences on what the guide covers'),
  approved: z.literal(true).describe('true once every section reads well together'),
})

export const writeGuide = createWorkflow({
  id: 'write-guide',
  description: 'Write a short guide on a topic, section by section.',
  input: z.object({ topic: z.string().min(2).describe('What the guide is about') }),
  agentInput: true, // it asks the agent, so it gets write_guide_next too
}).handler(async (ctx) => {
  const { topic } = ctx.input

  const plan = await ctx.elicitAgentInput('plan', {
    schema: Plan,
    instructions: 'Plan a short guide: propose 2 to 4 section titles for the topic.',
    // the shared context, sent once: later steps assume the agent has it
    data: { topic },
  })

  const sections: { title: string; body: string }[] = []
  for (const [index, title] of plan.sections.entries()) {
    const { body } = await ctx.elicitAgentInput(`section-${index + 1}-of-${plan.sections.length}`, {
      schema: Section,
      instructions: 'Write this section of the guide in 2 to 4 sentences.',
      data: { title },
    })
    sections.push({ title, body })
  }

  const review = await ctx.elicitAgentInput('review', {
    schema: Review,
    instructions: 'Read the whole guide. Summarize it, and approve it (approved: true).',
    data: { sections },
  })

  return ctx.step('publish', () => ({
    topic,
    summary: review.summary,
    sections,
    words: sections.reduce((sum, section) => sum + section.body.split(/\s+/).length, 0),
  }))
})
