#!/bin/bash
# PostToolUse(Edit|Write): format the edited file with oxfmt, if it's a file oxfmt handles.
# Runs oxfmt directly rather than `npm run format`, which would reformat the whole repo and
# pull unrelated files into the diff. Never blocks the edit.
file=$(jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0

# Vendored reference material is kept byte-identical to upstream so it can be re-synced.
# These same two paths are in .oxfmtrc.json ignorePatterns — keep the two lists in step, or
# `npm run format:check` will fail on files this hook deliberately leaves alone.
case "$file" in
  */.claude/skills/design/better-colors/* | */.claude/skills/design/better-typography/*) exit 0 ;;
esac

# Only the languages oxfmt formats. It handles Markdown and CSS as well as JS/TS/JSON — a
# narrower list here lets an unformatted .md through the hook and straight into a CI failure.
case "$file" in
  *.ts | *.tsx | *.mts | *.cts | *.js | *.jsx | *.mjs | *.cjs | *.json | *.jsonc | *.css | *.md) ;;
  *) exit 0 ;;
esac

npx --no-install oxfmt "$file" >/dev/null 2>&1 || true
exit 0
