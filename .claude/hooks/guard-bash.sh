#!/bin/bash
# PreToolUse(Bash): block destructive commands, unrequested reverts, and commits made
# directly on main.
cmd=$(jq -r '.tool_input.command // ""')

case "$cmd" in
  *"rm -rf /"* | *"rm -rf ~"* | *"rm -rf ."* | *"git reset --hard"*)
    echo "Blocked: destructive command. Use a safer alternative." >&2
    exit 2
    ;;
esac

# Force-pushing a feature branch is expected here: a rebase rewrites history and there is
# no other way to publish it. `.claude/rules/git-workflow.md` mandates
# `--force-with-lease --force-if-includes`, so only the BARE forms are blocked.
#
# Matching on the bare forms is what makes that possible. `--force` is only a match when
# the next character is a space or the end of the command, so `--force-with-lease` and
# `--force-if-includes` fall through. A substring test for "git push --force" matches the
# leased variants too, and blocking those pushes agents toward `git push origin +ref` or a
# delete-and-repush, both of which drop the lease this rule exists to keep.
#
# `[^&;|]*` keeps the flag in the same command segment, so `git push origin main && rm -f x`
# is not read as a force-push.
if echo "$cmd" | grep -qE 'git[[:space:]]+push[^&;|]*[[:space:]](--force|-f)([[:space:]]|$)'; then
  echo "Blocked: bare force-push. Use --force-with-lease --force-if-includes on a feature branch (.claude/rules/git-workflow.md). Pushing to a base branch needs an explicit yes." >&2
  exit 2
fi

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
