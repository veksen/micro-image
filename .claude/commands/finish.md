Run the completion checklist before declaring work done.

Do not claim a step passed without running it. Paste the evidence.

1. **Tests:** `npm run test`. All must pass.
   - A failing `it.fails` ledger test means a bug was just fixed. Retire it the way `BUGS.md`
     describes: flip `it.fails` to `it`, delete the matching characterization test, update the
     table. **Never delete a ledger test to make CI pass.**
2. **Lint:** `npm run lint`. This runs oxlint and then `scripts/design-lint.mjs`. Zero errors.
   The design-lint baseline is empty, so any violation it reports is new — fix it rather than
   adding the file to `scripts/design-lint-baseline.json`.
3. **Format:** `npm run format`. It runs `oxfmt .` over the whole repo, so check the diff after
   and revert files you didn't functionally change.
4. **Types:** `npm run typecheck`. Zero errors.
5. **Build:** `npm run build`. Must succeed.
6. **Self-review:** `/code-review` over the diff. Resolve findings.
7. **UI checks:** If the diff touches `apps/docs/src`, any `.css`, or what the published
   component renders, run `/design-review` and resolve every `[lint]` and `[axe]` finding.
8. **React checks:** If the diff touches React components or hooks, run the `react-doctor`
   skill and fix any new issues.
9. **Changeset:** If the diff changes `@micro-image/image` or `@micro-image/utils` — exports,
   prop names, the `exports` map, or the URL a provider generates — it is a published-API
   change and needs `npm run changeset`. Say so if you decide it doesn't.
10. **Scope check:** Confirm the diff contains ONLY task-related changes. Revert unrelated
    hunks, including stray formatter reflows and any `package-lock.json` churn you did not
    intend.
11. **Rebase:**
    - `git fetch origin main && git rebase origin/main`
    - Trivial conflicts: resolve, then re-run checks.
    - Non-trivial conflicts (contradicting logic, overlapping changes): STOP. Explain and ask
      for guidance. Do NOT guess. Other agents are working this repo concurrently, so a
      conflict is likely to be someone else's deliberate change.
12. **Post-rebase:** Re-run lint, typecheck, test, and build. All must pass.
13. **Summary:** Report what was done, what tests cover it, and any caveats.
