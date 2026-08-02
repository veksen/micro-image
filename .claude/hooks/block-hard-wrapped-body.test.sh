#!/usr/bin/env bash
# Feeds sample commands through block-hard-wrapped-body.sh exactly as the harness
# does, and checks each against its expected verdict. Run from the repo root.
HOOK=.claude/hooks/block-hard-wrapped-body.sh

fail=0
fixtures=$(mktemp -d)
trap 'rm -rf "$fixtures"' EXIT

cat >"$fixtures/wrapped.md" <<'EOF'
## Goal

This change ports the hard-wrapped body gate into micro-image so that PR
bodies stop arriving ragged once they are published to GitHub.
EOF

cat >"$fixtures/clean.md" <<'EOF'
## Goal

This change ports the hard-wrapped body gate into micro-image so that PR bodies stop arriving ragged once they are published to GitHub.

## What

Before, a wrapped body shipped as written. Now the hook rejects it.
EOF

# The false-positive case: short adjacent lines are correct in tables, fences
# and lists. If this blocks, the gate gets turned off and stops earning its keep.
cat >"$fixtures/structured.md" <<'EOF'
## Results

| Format | Quality | Effort |
| ------ | ------- | ------ |
| avif   | 50      | 4      |
| webp   | 80      | 4      |

```ts
const meta = resolve(src)
const url = provider.generateUrl(meta)
```

- Keeps every frame of an animated gif
- Emits avif at quality 50
- Pins the benchmark baseline

> A blockquote line
> and its continuation.
EOF

check() {
  local expected="$1" label="$2" cmd="$3"
  local out actual
  out=$(printf '%s' "$cmd" | jq -Rs '{tool_input:{command:.}}' | bash "$HOOK" 2>&1)
  if [ $? -eq 0 ]; then actual="allow"; else actual="block"; fi

  if [ "$actual" = "$expected" ]; then
    printf '  ok   %-8s %s\n' "$actual" "$label"
  else
    printf '  FAIL want=%s got=%s  %s\n      -> %s\n' "$expected" "$actual" "$label" "$out"
    fail=1
  fi
}

echo "--body-file is how this repo publishes; it must be read and judged:"
check block '--body-file, wrapped' "gh pr create --body-file $fixtures/wrapped.md"
check block '-F, wrapped' "gh pr edit 68 -F $fixtures/wrapped.md"
check block '--body-file=, wrapped' "gh issue comment 4 --body-file=$fixtures/wrapped.md"
check allow '--body-file, clean' "gh pr create --body-file $fixtures/clean.md"
check allow '-F, clean' "gh pr edit 68 -F $fixtures/clean.md"

echo
echo "structure is not wrapped prose (the false positive that kills a gate):"
check allow 'tables, fences, lists, quotes' "gh pr create --body-file $fixtures/structured.md"

echo
echo "a body the hook cannot see is not a body it may block:"
check allow 'stdin' 'gh pr create --body-file -'
check allow 'file not written yet' "gh pr create --body-file $fixtures/absent.md"

echo
echo "inline --body still works, heredoc or quoted:"
check block 'heredoc, wrapped' 'gh pr create --body "$(cat <<'"'"'EOF'"'"'
This is prose that an agent hard wrapped at about eighty columns,
which is exactly the habit this gate exists to catch.
EOF
)"'
check block 'quoted string, wrapped' 'gh pr create --body "This line was wrapped by hand,
and this is the fragment that follows it."'
check allow 'quoted string, one line' 'gh pr create --body "One line paragraph that is perfectly fine."'

echo
echo "trailing flags are flags, not prose:"
check allow 'clean body then --label/--assignee' 'gh pr create --body "One line paragraph that is perfectly fine." \
  --label chore \
  --assignee me'
check allow 'clean --body-file then --label' "gh pr create --body-file $fixtures/clean.md \\
  --label chore \\
  --assignee me"

echo
echo "wrapping is correct in a commit message, and untouched here:"
check allow 'git commit heredoc' 'git commit -m "chore(hooks): block hard-wrapped bodies

GitHub renders every newline in a PR body as a line break.
Prose wrapped at 72 columns therefore arrives ragged."'

echo
echo "unrelated commands still fine:"
check allow 'npm run test' 'npm run test'
check allow 'gh pr view' 'gh pr view 68'
check allow 'gh pr list' 'gh pr list --state open'

echo
[ "$fail" -eq 0 ] && echo "ALL PASS" || echo "FAILURES ABOVE"
exit "$fail"
