# @example/cli

`src/main.ts` is one call: `runCli(contract, { transport: rpc({ url }) })`.
Commands, flags, tables, `--team` on scoped commands, the `--yes` guard on
destructive ops and `login`/`logout`/`whoami` come from the contract.

```bash
pnpm cli redis list --team team_42     # no build: runs the TypeScript
pnpm build && npx acme redis get db_1   # tsdown → single-file dist/main.js (the `acme` bin)
pnpm skill                              # regenerate skills/acme-cli/SKILL.md for agents
```

| variable       | meaning                                              |
| -------------- | ---------------------------------------------------- |
| `ACME_API_URL` | backend (default `http://localhost:3000/api`)        |
| `ACME_API_KEY` | API key; or store one with `acme login --with-token` |
| `ACME_TEAM`    | default team, overridden by `--team`                 |
