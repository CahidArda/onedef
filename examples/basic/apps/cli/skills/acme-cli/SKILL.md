---
name: acme-cli
description: "Manage Acme Redis databases from the terminal: list, inspect, create, rename, rotate tokens and delete. Use when the user asks to work with their Acme databases."
---

# acme CLI

Run commands as `acme <service> <command> [args] [flags]`. Lists print as tables, everything else as JSON; pass `--json` to always get JSON. `acme <command> --help` shows every flag.

Exit codes: 0 ok, 1 error, 2 bad usage or input, 3 not found, 4 not authenticated, 5 API error.

## Authentication

- Preferred for agents: set `ACME_API_KEY`. It takes precedence over any stored login.
- Or store a key once: `echo "$KEY" | acme login --with-token`.
- `acme whoami` shows which credentials are in use; exit code 4 means none are.

## Environment

- `ACME_API_KEY` — Any non-empty string works against the example backend.
- `ACME_TEAM` — default team, overridden by --team
- `ACME_API_URL` — backend url (default http://localhost:3000/api)

## Commands

### `acme redis list [--team <string>] [--region <string>]`

List redis

- `--team` (string) — Team to operate on. Omit to use your personal account.
- `--region` (string) — Filter by region

### `acme redis get <database_id>`

Get one of redis by database_id

### `acme redis create [--team <string>] --name <string> [--region <string>]`

Create one of redis

- `--team` (string) — Team to operate on. Omit to use your personal account.
- `--name` (string, required) — Database name
- `--region` (string) — Primary region

### `acme redis delete <database_id>`

Delete one of redis permanently **Destructive**: requires `--yes`; confirm with the user first.

### `acme redis rename <database_id> --name <string>`

Rename a database

- `--name` (string, required) — The new database name

### `acme redis reset-password <database_id>`

Rotate the tokens of a database **Destructive**: requires `--yes`; confirm with the user first.
