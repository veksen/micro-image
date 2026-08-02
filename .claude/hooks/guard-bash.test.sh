#!/usr/bin/env bash
# Feeds sample commands through guard-bash.sh exactly as the harness does, and
# checks each against its expected verdict. Run from the repo root.
HOOK=.claude/hooks/guard-bash.sh

fail=0

check() {
  local expected="$1" cmd="$2"
  local out actual
  out=$(printf '%s' "$cmd" | jq -R '{tool_input:{command:.}}' | bash "$HOOK" 2>&1)
  if [ $? -eq 0 ]; then actual="allow"; else actual="block"; fi

  if [ "$actual" = "$expected" ]; then
    printf '  ok   %-8s %s\n' "$actual" "$cmd"
  else
    printf '  FAIL want=%s got=%s  %s\n      -> %s\n' "$expected" "$actual" "$cmd" "$out"
    fail=1
  fi
}

echo "must be ALLOWED (leased push of a feature branch):"
check allow 'git push --force-with-lease --force-if-includes'
check allow 'git push --force-with-lease --force-if-includes origin my-feature'
check allow 'git push -u origin HEAD'
check allow 'git push origin main'

echo
echo "must be BLOCKED (bare force, any target):"
check block 'git push --force'
check block 'git push -f origin my-feature'
check block 'git push --force origin my-feature'

echo
echo "must be BLOCKED (leased, but aimed at a base branch):"
check block 'git push --force-with-lease origin main'
check block 'git push --force-with-lease --force-if-includes origin main'
check block 'git push --force-with-lease origin HEAD:main'
check block 'git push --force-with-lease origin master'
check block 'git push --force-with-lease upstream staging'

echo
echo "prose that merely mentions a force-push is not one:"
# This is not hypothetical. The commit that added the base-branch check was itself
# blocked by it: the message quoted the deny glob and mentioned main, and the hook
# matches raw command text.
check allow 'git commit -m "settings still denies Bash(git push --force*), which also blocks the leased form on main"'
check allow 'echo "run git push --force-with-lease origin main to publish" > notes.txt'

echo
echo "a real push is still caught when it follows a separator:"
check block 'npm run build && git push --force-with-lease origin main'
check block 'npm run build; git push --force'

echo
echo "unrelated commands still fine:"
check allow 'npm run test'
check allow 'git status --short'

echo
[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "FAILURES ABOVE"
exit "$fail"
