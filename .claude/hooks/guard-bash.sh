#!/bin/bash
# PreToolUse(Bash): block destructive commands, unrequested reverts, and commits made
# directly on main.
cmd=$(jq -r '.tool_input.command // ""')

case "$cmd" in
  *"rm -rf /"* | *"rm -rf ~"* | *"rm -rf ."* | *"git reset --hard"* | *"git push --force"* | *"git push -f "*)
    echo "Blocked: destructive command. Use a safer alternative (e.g. --force-with-lease on a feature branch)." >&2
    exit 2
    ;;
esac

# Reverting is never the agent's call to make unprompted — propose a forward fix, or ask.
if echo "$cmd" | grep -qE '(^|\s|&&|\|\||;)\s*git\s+(revert|checkout\s+HEAD(~|\^)|restore\s+--source)'; then
  echo "Blocked: do not revert or roll back on your own. Prefer a forward fix; if a revert is genuinely right, propose it and wait for a yes." >&2
  exit 2
fi

# Block commits while HEAD is on main. Checks the actual branch, not the commit message, so
# messages that mention "main" are not falsely blocked.
if echo "$cmd" | grep -qE '(^|\s|&&|\|\||;)\s*git\s+commit'; then
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  if [ "$branch" = "main" ]; then
    echo "Blocked: cannot commit directly to 'main'. Create a feature branch first (git checkout -b <type>/<desc>)." >&2
    exit 2
  fi
fi

exit 0
