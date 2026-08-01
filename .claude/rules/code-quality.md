---
globs: "**/*.ts,**/*.tsx,**/*.mts,**/*.js,**/*.jsx,**/*.mjs"
---

# Code Quality Checklist

Before declaring done, verify:

- Does this actually solve the stated problem?
- Any obvious bugs, off-by-one, unhandled cases?
- Is error handling present and meaningful?
- Any security issues (injection, SSRF, auth bypass, data exposure)? The proxy fetches
  arbitrary remote URLs, so this is a live concern, not a checkbox — see `BUGS.md`.
- Is the code readable to someone who didn't write it?
- Names descriptive and consistent with the glossary in `CONTEXT.md`?
- Any dead code, debugging artifacts, or abandoned TODOs?
- Any unnecessary new dependencies?
- Could this break existing functionality?

## Scope Discipline

- Only modify files directly related to the task. No drive-by cleanups.
- Never reformat or adjust whitespace in code you didn't functionally change.
- Never edit `package-lock.json` directly. It changes only as a side effect of `npm install`
  when dependencies actually change. A PreToolUse hook blocks writes to it.
- NEVER delete `package-lock.json` — not to fix an install, not to "regenerate" it. On a
  lockfile conflict, run `npm install` to resolve it.
- After making changes, review `git diff` and revert unrelated hunks.
- `npm run format` runs `oxfmt .` across the whole repo, so it can reformat files you never
  touched. Check the diff afterwards and revert what isn't yours (`git checkout -- <file>`).
- Checklist gate: "Does this diff contain ONLY changes related to the stated task?"

## Rules

- Follow existing codebase patterns. Don't introduce new ones without discussion.
- Prefer simple, boring code over clever code.
- Don't over-engineer. Solve the problem at hand.
- Run `npm run lint` and `npm run format` after changes. Fix every issue.
- Three agents work this repo concurrently in separate worktrees. Before editing shared files
  (root `package.json`, `turbo.json`, `render.yaml`, CI workflows), check whether another
  branch is already changing them.

## Published packages

`@micro-image/image` and `@micro-image/utils` ship to npm. In those packages, treat exported
names, prop shapes, the `exports` map, and the URL a provider generates as public API. Changing
any of them is a breaking change and needs a changeset. Adding an optional prop is not.
