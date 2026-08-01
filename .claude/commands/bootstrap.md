Come back to this repo cold and get it to a known-good state before doing anything else.

This project has already gone dormant once, for two and a half years. This command exists so
the next return costs minutes rather than an afternoon of rediscovery.

## 1. Read the orientation, in this order

- `.claude/vision-digest.md` — injected at session start, but read it deliberately.
- `CLAUDE.md` — the charter and the index to everything else.
- `CONTEXT.md` — packages, glossary, commands, toolchain, known bugs, roadmap.
- `BUGS.md` — the ledger. Every known defect is pinned by two tests.
- `docs/adr/` — nine decisions, seven of them still `proposed`.

## 2. Check the environment

- `node --version` against `.nvmrc`. The toolchain assumes Node 24; TypeScript 7 and Vite 8
  will fail in confusing ways on an older runtime.
- `npm ci`. Not `npm install` — `ci` installs exactly what the lockfile records and never
  rewrites it. `npm install` is the deliberate tool for changing a dependency.

## 3. Establish the baseline

Run the full gate and record what you see before changing anything:

```
npm run lint && npm run typecheck && npm run test && npm run build
```

The suite is **green on purpose** — every known bug is pinned by a characterization test plus
an `it.fails` ledger test. If something is red here, it is a real regression or an environment
problem, not the backlog. Find out which before you start.

## 4. Check what else is moving

Several agents work this repo in separate worktrees.

- `git worktree list`
- `git fetch origin && git branch -r`
- `gh pr list --state open`

Note anything touching the files you are about to touch — root `package.json`, `turbo.json`,
`render.yaml`, and CI workflows are the usual collisions.

## 5. Pick the work

- Resuming something specific → `/start <issue#>`.
- Nothing assigned → the roadmap in `CONTEXT.md` is ordered, and each step is independently
  useful. Milestones 1 and 2 are runtime and proxy fixes that several ledger tests already
  describe.
- Before writing code that assumes an answer to an open ADR, resolve that ADR instead.

Report what you found: environment state, gate result, in-flight work, and the step you propose
starting. Then stop and wait.

$ARGUMENTS
