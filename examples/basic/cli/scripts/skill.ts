import { writeFile } from 'node:fs/promises'
import { contract } from '@example/basic-contract'
import { toSkillMarkdown } from '@onedef/cli'

// Regenerate after any contract change (pnpm skill): the skill teaches an
// agent the CLI, so it must describe the CLI that actually exists.
const markdown = toSkillMarkdown(contract, {
  bin: 'acme',
  description:
    'Manage Acme Redis databases from the terminal: list, inspect, create, rename, rotate tokens and delete. Use when the user asks to work with their Acme databases.',
  env: [
    { name: 'ACME_TEAM', description: 'default team, overridden by --team' },
    { name: 'ACME_API_URL', description: 'backend url (default http://localhost:3000/api)' },
  ],
})
await writeFile(new URL('../skills/acme-cli/SKILL.md', import.meta.url), markdown)
console.log('skills/acme-cli/SKILL.md')
