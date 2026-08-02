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
# `git push` must sit at a command position: the start of a line, or straight after a
# separator. grep works line by line, so `^` is per line of the command. Without this a
# commit message that merely QUOTES a force-push is read as one, which is the same trap the
# commit-on-main check below already avoids by inspecting the branch instead of the text.
push_at_command_position='(^|[;&|][[:space:]]*)git[[:space:]]+push'

if echo "$cmd" | grep -qE "${push_at_command_position}[^&;|]*[[:space:]](--force|-f)([[:space:]]|\$)"; then
  echo "Blocked: bare force-push. Use --force-with-lease --force-if-includes on a feature branch (.claude/rules/git-workflow.md). Pushing to a base branch needs an explicit yes." >&2
  exit 2
fi

# A force-push aimed at a base branch is never the agent's call, leased or not. The check
# above deliberately lets the leased variants through, so what they are aimed AT has to be
# checked separately — otherwise allowing `--force-with-lease` also allows rewriting main.
if echo "$cmd" | grep -qE "${push_at_command_position}[^&;|]*[[:space:]]--force"; then
  base_branches='main|master|develop|staging'

  # An explicit destination wins: `origin main`, or the right-hand side of `HEAD:main`.
  # Read only from the push itself, so an unrelated later line cannot supply the branch
  # name — a commit message mentioning main must not turn a feature push into a base one.
  push_segment=$(echo "$cmd" |
    grep -E "${push_at_command_position}" |
    head -1 |
    sed -E 's/.*git[[:space:]]+push//; s/[&;|].*//')

  destination=$(echo "$push_segment" |
    grep -oE "[[:space:]:](${base_branches})([[:space:]]|\$)" |
    head -1 | tr -d ' :')

  # With no refspec at all, the push updates whatever HEAD tracks. Only consult HEAD in
  # that case, so `git push --force-with-lease origin my-branch` while sitting on main is
  # judged by its destination rather than by where the shell happens to be.
  if [ -z "$destination" ]; then
    args=$(echo "$push_segment" | tr ' ' '\n' | grep -cE '^[^-][^[:space:]]*$' || true)

    if [ "${args:-0}" -eq 0 ]; then
      destination=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
    fi
  fi

  case "$destination" in
    main | master | develop | staging)
      echo "Blocked: force-push aimed at '$destination'. Rewriting a base branch needs an explicit yes from the user (.claude/rules/git-workflow.md)." >&2
      exit 2
      ;;
  esac
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
