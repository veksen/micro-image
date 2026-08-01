#!/bin/bash
# PreToolUse(Bash): force tooling through npm scripts so the agent, hooks, and CI all run the
# identical command.
#
# Only the leading program of each command segment is inspected, so tool names appearing inside
# arguments (a commit message mentioning "oxfmt", say) are not blocked.
cmd=$(jq -r '.tool_input.command // ""')

# Split on shell separators (&& || ; | and newlines) into one segment per line.
segments=$(printf '%s' "$cmd" | sed -E 's/(\&\&|\|\||;|\|)/\n/g')

blocked=0
while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"
  first=$(printf '%s' "$seg" | awk '{print $1}')
  # `npx <tool>` — inspect the tool, not npx.
  if [ "$first" = "npx" ]; then
    first=$(printf '%s' "$seg" | awk '{print $2}')
  fi
  case "$first" in
    turbo | oxlint | oxfmt | vitest | tsdown | tsc) blocked=1 ;;
  esac
done <<EOF
$segments
EOF

if [ "$blocked" -eq 1 ]; then
  echo "Blocked: do not invoke turbo/oxlint/oxfmt/vitest/tsdown/tsc directly. Use the project's npm scripts (npm run lint, npm run format, npm run typecheck, npm run test, npm run build) so you run what CI runs." >&2
  exit 2
fi
exit 0
