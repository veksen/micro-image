---
globs: "*"
---

# Git Workflow

## Branch Discipline

- One issue = one branch = one PR. No multi-issue branches.
- Branch from `main` unless depending on an unmerged branch.
- Naming: `<type>/<description>` — kebab-case description, matching the branches already in
  this repo (`feature/benchmark`, `chore/claude-harness`).
- Types: `feat`, `fix`, `refact`, `style`, `docs`, `tests`, `chore`, `build`, `ci`, `perf`, `ui`.
- Description: concrete nouns/verbs, max 3–4 words. Describe WHAT changes, not WHY.
  - Good: `feat/meta-endpoint`, `fix/animated-gif-guard`, `chore/bump-turbo`
  - Bad: `feat/improvements`, `fix/bug`, `refact/cleanup`

## Commit Convention

- Format: `<type>(<scope>): <short infinitive message>`
- Scope: the area affected — `image`, `cache`, `docs`, `utils`, `deps`, `claude`.
- Message: infinitive verb, lowercase, no period.
- One logical change per commit.

## Pushing

- `main`: ask before pushing anything to it. Rewriting its history is sometimes the necessary
  fix, so it is allowed with an explicit yes, never as a judgment call.
- Feature branches: force-pushing is expected after a rebase. Rewritten history has no other
  way to reach the remote.
- Use `--force-with-lease --force-if-includes`. The lease refuses the push when the remote
  branch moved; `--force-if-includes` also refuses when the remote tip never reached your
  reflog, which is the case a lease alone lets through.
- A rejected lease means someone else's commit is on the branch. Do not retry with bare
  `--force`. Report what would have been overwritten and let the user decide.

## Concurrent work

More than one agent works this repo at a time, in separate worktrees. Before editing shared
files — root `package.json`, `turbo.json`, `render.yaml` — check whether another branch is
already touching them (`git worktree list`, then `git status` in each). Prefer changes that
do not touch shared files at all.

## PR Convention

- Title: `<type>(<scope>): <description>`, same grammar as commits.
- Body sections, in this order. Write for a teammate who has read neither the issue nor the
  diff. One fact per sentence.

### Goal

The end-user outcome this work is after, in one or two sentences, linked to its parent issue.
What this PR contributes, and the next step. If it is the last step, say so.

### What

The behavior change as before → after, in plain words. Lead with what a consumer observes,
not with the mechanism.

### How

The mechanism, briefly, with a reading order for the diff: which file to open first, and what
each area does. Design decisions and trade-offs go here — never in Goal or What.

### Tests

What behavior is covered. State the verification result (suite, lint, build) plainly.

## Completing Work

1. Full test suite passes.
2. Linter and formatter: zero issues.
3. Build succeeds.
4. Self-review performed (`/code-review`).
5. Rebase: `git fetch origin main && git rebase origin/main`.
6. After rebase: re-run tests, linter, formatter, build.
7. Only then declare complete.
