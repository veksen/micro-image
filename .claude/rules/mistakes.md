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
