Start work on an issue, anchored to the vision.

**First, feed the vision.** Read `.claude/vision-digest.md` (the always-on north star). Every
decision below is judged against the guiding principle and values it names.

Then:

1. **Fetch the issue.** If `$ARGUMENTS` is an issue number, `gh issue view` it. Restate the
   deliverable and acceptance criteria in one line. If no issue exists, state the task in one
   line instead.
2. **Check for concurrent work.** `git worktree list` — more than one agent works this repo at
   a time. If another worktree is touching the same files, say so before branching.
3. **Branch from `main`.** `git fetch origin main` then
   `git checkout -b <type>/<short-description>` per `.claude/rules/git-workflow.md` (types:
   feat/fix/refact/style/docs/tests/chore/build/ci/ui/perf; kebab-case, ≤3–4 words). NEVER
   work on `main`.
4. **Research.** Read the relevant source, existing patterns, `BUGS.md`, and
   `.claude/rules/mistakes.md`. Don't guess at unfamiliar APIs — look them up
   (`.claude/rules/research.md`).
5. **Mini plan (vision-anchored).** Before any code, produce a short plan:
   - What changes, which files, the approach, risks, tests needed.
   - **Vision check:** one line naming which value(s) from the vision this serves — and
     whether it fits the guiding principle or pulls against it (if so, reconsider).
   - **Open decisions:** if the work assumes an answer to one of the proposed ADRs in
     `docs/adr/`, resolve that ADR first rather than deciding it implicitly in code.
6. **Grill the plan.** Hand the mini plan to `/grill-me` and let it interview you until every
   open branch of the design is resolved — don't present a plan that hasn't survived the
   grilling. Skip only for trivial, single-file changes with nothing to stress-test; say so
   explicitly when you do.
7. **Wait for confirmation.** Do NOT write code until the grilled plan is approved.

Task: $ARGUMENTS
