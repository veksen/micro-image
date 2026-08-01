---
globs: "*"
---

# Mistakes Log

Record mistakes here using `/learn` so they don't happen again. New entries at the top.

Format:

```
## YYYY-MM-DD: [Short description]
- **What happened:** [What went wrong]
- **Root cause:** [Why it went wrong]
- **What to do instead:** [Concrete action for next time]
```

---

## 2026-08-01: Narrowed a formatter's file list without checking what it formats

- **What happened:** `format-file.sh` was written to pass only `.ts/.tsx/.js/.json` to oxfmt,
  dropping the `.md` and `.css` the source hook included. oxfmt formats Markdown, so fourteen
  unformatted `.md` files went straight past the hook into a red `npm run format:check` in CI.
- **Root cause:** Assumed a formatter's scope from its name instead of checking. The narrowing
  was not even deliberate — the list was retyped rather than adapted, and the omission looked
  like a JS-only formatter behaving normally.
- **What to do instead:** When a hook filters by file extension, derive the list from what the
  tool actually handles, and check it against the repo-wide command that will run in CI. If a
  hook skips paths on purpose, the same paths must be in the tool's own ignore config —
  otherwise the repo-wide check fails on exactly the files the hook was told to leave alone.

## 2026-08-01: Ported a harness pattern its own author had already deleted

- **What happened:** While porting the agent harness from `monorepo-boilerplate`, proposed
  shipping `design-review-reminder.sh` and inventing a second advisory PostToolUse hook — a
  pattern deleted from `Query-Doctor/Site` a week earlier for duplicating always-loaded
  guidance, firing after the edit, and never reaching un-rebased worktrees.
- **Root cause:** Treated the boilerplate as the canonical source without checking whether it
  was current. It was frozen mid-migration: it had taken the rules→skills move but not the
  hook removal that followed two days later.
- **What to do instead:** When porting from another repo, check that repo's git log for the
  area you're copying before copying it. A boilerplate is a snapshot, not a source of truth —
  find the repo where the pattern is actually maintained and read its history.
