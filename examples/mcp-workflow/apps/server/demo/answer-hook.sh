#!/bin/bash
# A Claude Code Elicitation hook that plays the user, answering each form by its fields.
# (Headless `claude -p` cancels a form nobody answers; the hook answers it.)
input=$(cat)
fields=$(jq -c '.requested_schema.properties // {} | keys' <<<"$input")
case "$fields" in
  '["confirm"]') content='{"confirm": true}' ;;
  '["approved","feedback"]') content='{"approved": true, "feedback": "Looks good"}' ;;
  '["channel","notes"]') content='{"channel": "beta", "notes": "Faster builds"}' ;;
  *) content='' ;;
esac
[ -n "$DEPLOY_LOG" ] && echo "$(date -u +%Y-%m-%dT%H:%M:%S.000Z) USER asked: $(jq -r .message <<<"$input" | head -1) fields=$fields -> ${content:-declined}" >> "$DEPLOY_LOG"
if [ -n "$content" ]; then
  jq -n --argjson content "$content" '{hookSpecificOutput: {hookEventName: "Elicitation", action: "accept", content: $content}}'
else
  jq -n '{hookSpecificOutput: {hookEventName: "Elicitation", action: "decline"}}'
fi
