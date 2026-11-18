import { writeFile } from 'node:fs/promises'
import { contract } from '@upstash-example/recipe'
import { toSkillMarkdown } from '@onedef/cli'

// Regenerate after any contract change: the skill teaches an agent the CLI, so
// it must describe the CLI that actually exists.
const markdown = toSkillMarkdown(contract, {
  bin: 'upstash-redis',
  description:
    'Manage Upstash Redis databases from the terminal: list, inspect, create, rename, delete, and run Redis commands. Use when the user asks to work with their Upstash Redis databases.',
  env: [{ name: 'UPSTASH_TEAM_ID', description: 'default team, overridden by --team' }],
})
await writeFile(new URL('../skills/upstash-redis-cli/SKILL.md', import.meta.url), markdown)
console.log('skills/upstash-redis-cli/SKILL.md')
