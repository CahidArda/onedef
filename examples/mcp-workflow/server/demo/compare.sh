#!/bin/bash
# Deploy once through each server with Claude Code, and count the builds.
#   plain:    the MCP SDK's elicitation       -> the build runs again after the answer
#   workflow: @onedef/mcp-elicitation-workflow     -> the build runs once (ctx.approve, ctx.elicitInput)
# Needs: claude (logged in), jq. Run from examples/mcp-workflow/server: ./demo/compare.sh
set -euo pipefail
cd "$(dirname "$0")/.."
work=$(mktemp -d)
export DEPLOY_LOG="$work/deploy.log"
: > "$DEPLOY_LOG"

PORT=3334 npx tsx demo/plain-deploy.ts > "$work/plain.out" 2>&1 & plain=$!
PORT=3335 npx tsx src/main.ts > "$work/workflow.out" 2>&1 & workflow=$!
trap 'kill $plain $workflow 2>/dev/null' EXIT
sleep 5

cat > "$work/settings.json" <<JSON
{ "hooks": { "Elicitation": [ { "matcher": ".*", "hooks": [ { "type": "command", "command": "$PWD/demo/answer-hook.sh" } ] } ] } }
JSON
cat > "$work/mcp.json" <<JSON
{ "mcpServers": {
  "plain": { "type": "http", "url": "http://localhost:3334/mcp" },
  "workflow": { "type": "http", "url": "http://localhost:3335/mcp" } } }
JSON

run() {
  echo "== claude: $1"
  (cd "$work" && claude -p "$1" --settings settings.json --mcp-config mcp.json --strict-mcp-config \
    --allowedTools "mcp__plain__deploy" "mcp__workflow__deploy" "mcp__workflow__deploy_next" \
      "mcp__workflow__release" "mcp__workflow__release_next" \
    --output-format text < /dev/null) | tail -3
}
run "Deploy to staging with the plain server's deploy tool. Report what it returned, in one line."
run "Deploy to staging with the workflow server's deploy tools. Report what they returned, in one line."
run "Release version 2.1.0 with the workflow server's release tools. Report what they returned, in one line."

echo
echo "== what ran"
sed -E 's/^[^ ]+ //' "$DEPLOY_LOG"
echo
echo "builds per run: plain deploy $(grep -c 'plain deploy: BUILD' "$DEPLOY_LOG"), workflow deploy (ctx.approve) $(grep -c 'workflow deploy: BUILD' "$DEPLOY_LOG"), workflow release (ctx.elicitHumanInput) $(grep -c 'workflow release: BUILD' "$DEPLOY_LOG")"
