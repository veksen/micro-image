# micro-image

An end-to-end responsive image stack: a self-hosted image proxy, a framework-agnostic
`<Image>` component, and (planned) a build-time plugin that enriches images statically so
the component never has to discover anything at runtime.

Read `.claude/vision-digest.md` first — it is injected every session and every decision here
is judged against it. `VISION.md` carries the full architecture, non-goals, and success
criteria.

## Stack

> **Pending.** The toolchain is mid-upgrade in a parallel branch. This section is filled in
> once the library bump lands; until then read `CONTEXT.md` § Toolchain, which records the
> current pinned versions and flags which of them are expected to change.

## Workflow

Follow these in order. Do not skip steps and do not claim a step passed without running it.

1. **Research.** Read the existing source before proposing anything. Grep for the pattern
   already in the repo. Look up unfamiliar APIs rather than recalling them
   (`.claude/rules/research.md`). Check `.claude/rules/mistakes.md`.
2. **Plan.** For anything non-trivial, state what changes, which files, the approach, the
   risks, and the tests. Wait for confirmation before writing code (`/plan`).
3. **Implement.**
4. **Test.** `npm run test`. The suite is green on purpose — see `BUGS.md` before touching
   a failing test, and never delete a ledger test to make CI pass.
5. **Lint and format.** `npm run lint`, `npm run format`.
6. **Build.** `npm run build`.
7. **Self-review.** `/code-review` over the diff. Resolve findings.
8. **Rebase.** `git fetch origin main && git rebase origin/main`, then re-run 4–6.

## Constraints

- **Do not run `npm run dev`.** It starts persistent watchers that never exit.
- **Use `npm ci`, not `npm install`.** Root `package.json` declares `"turbo": "latest"` while
  the lockfile pins `1.12.4`, and turbo 2+ renamed `turbo.json`'s `pipeline` key to `tasks`.
  A stray `npm install` can silently upgrade turbo and break every task in the repo.
- **Never commit on `main`.** Branch first (`.claude/rules/git-workflow.md`). A PreToolUse
  hook enforces this.
- **Never revert without asking.** Prefer a forward fix. If a revert genuinely looks right,
  propose it and wait for a yes.
- **The published surface is an API.** `@micro-image/image` and `@micro-image/utils` ship to
  npm. Changing their exports, prop names, or URL output is a breaking change and needs a
  changeset.

## Architecture invariants

Two things decay silently as the repo grows from 4 packages to ~8. Both are enforced by
judgment, not by tooling:

- **`ImageMeta` is the single source of truth.** Build-time, runtime, and no-proxy paths all
  produce the same shape. Load `.claude/skills/image-meta-contract/` before touching
  `providers/` or any future `plugin-*` package.
- **Adapters stay thin.** A framework package finds `<Image>` and rewrites it. File reading,
  sharp, caching, and LQIP live in the shared core. An adapter that grows a second job is a bug.

## Honesty

Non-negotiable, and it outranks appearing productive:

- Never claim something works without having run it. Paste the evidence.
- If a step was skipped, say which and why.
- If tests fail, report the failure with its output — do not describe it as passing.
- Asking a clarifying question beats guessing. Guessing beats nothing only when the guess is
  labeled as one.

## Agent skills

### Issue tracker

Issues live as GitHub issues on `veksen/micro-image`, via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## Reference

- `CONTEXT.md` — package map, glossary, conventions, toolchain pins, known bugs
- `VISION.md` — north star, architecture, non-goals, success criteria
- `BUGS.md` — the bug ledger and the `it.fails` convention that tracks it
- `docs/adr/` — architecture decisions, including seven still open
- `.claude/rules/` — always-on: git workflow, research, mistakes
- `.claude/skills/` — on-demand: testing conventions, the `ImageMeta` contract
