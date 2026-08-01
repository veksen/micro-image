Run the completion checklist before declaring work done.

Do not claim a step passed without running it. Paste the evidence.

1. **Tests:** `npm run test`. All must pass.
   - A failing `it.fails` ledger test means a bug was just fixed. Retire it the way `BUGS.md`
     describes: flip `it.fails` to `it`, delete the matching characterization test, update the
     table. **Never delete a ledger test to make CI pass.**
2. **Lint:** `npm run lint`. Zero errors.
3. **Format:** `npm run format`.
4. **Build:** `npm run build`. Must succeed.
5. **Self-review:** `/code-review` over the diff. Resolve findings.
6. **React checks:** If the diff touches React components or hooks, run the `react-doctor`
   skill and fix any new issues.
7. **Changeset:** If the diff changes `@micro-image/image` or `@micro-image/utils` — exports,
   prop names, or the URL a provider generates — it is a published-API change and needs
   `npm run changeset`. Say so if you decide it doesn't.
8. **Scope check:** Confirm the diff contains ONLY task-related changes. Revert unrelated
   hunks, including stray formatter reflows and any `package-lock.json` churn you did not
   intend.
9. **Rebase:**
   - `git fetch origin main && git rebase origin/main`
   - Trivial conflicts: resolve, then re-run checks.
   - Non-trivial conflicts (contradicting logic, overlapping changes): STOP. Explain and ask
     for guidance. Do NOT guess. Other agents are working this repo concurrently, so a
     conflict is likely to be someone else's deliberate change.
10. **Post-rebase:** Re-run tests, lint, format, build. All must pass.
11. **Summary:** Report what was done, what tests cover it, and any caveats.

> Two steps are missing until the library bump lands: `npm run check-types`, and
> `/design-review` for diffs touching the UI layer. Both arrive with the follow-up harness PR.
