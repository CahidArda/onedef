---
name: upstash-redis-cli
description: "Manage Upstash Redis databases from the terminal: list, inspect, create, rename, delete, and run Redis commands. Use when the user asks to work with their Upstash Redis databases."
---

# upstash-redis CLI

Run commands as `upstash-redis <service> <command> [args] [flags]`. Lists print as tables, everything else as JSON; pass `--json` to always get JSON. `upstash-redis <command> --help` shows every flag.

Exit codes: 0 ok, 1 error, 2 bad usage or input, 3 not found, 4 not authenticated, 5 API error.

## Authentication

- `upstash-redis whoami` shows which credentials are in use; exit code 4 means none are.

## Environment

- `UPSTASH_EMAIL` — username (basic auth)
- `UPSTASH_API_KEY` — password or key (basic auth)
- `UPSTASH_TEAM_ID` — default team, overridden by --team

## Commands

### `upstash-redis redis list [--team <string>]`

List databases

- `--team` (string) — Team to operate on. Omit to use your personal account.

### `upstash-redis redis get <database_id>`

Get a database with its endpoint and credentials

### `upstash-redis redis create [--team <string>] --name <string> --primary-region <string> [--read-regions <json>]`

Create a database

- `--team` (string) — Team to operate on. Omit to use your personal account.
- `--name` (string, required) — Database name
- `--primary-region` (string, required, one of us-east-1, us-east-2, us-west-1, us-west-2, ca-central-1, sa-east-1, eu-west-1, eu-west-2, eu-central-1, eu-central-2, ap-south-1, ap-southeast-1, ap-southeast-2, ap-northeast-1, ap-northeast-2) — Primary region
- `--read-regions` (json) — Read replica regions

### `upstash-redis redis rename <database_id> --name <string>`

Rename a database

- `--name` (string, required) — The new database name

### `upstash-redis redis delete <database_id>`

Delete a database permanently **Destructive**: requires `--yes`; confirm with the user first.

### `upstash-redis redis query <database_id> --command <json>`

Run a Redis command against a database

Executes one command via the database REST API, e.g. ["SET","greeting","hello"] or ["GET","greeting"].

- `--command` (json, required) — The command as tokens, e.g. ["SET", "key", "value"]
