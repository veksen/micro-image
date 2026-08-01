---
name: testing
description: Use whenever writing, modifying, reviewing, or debugging tests in this repo — Vitest unit tests for the proxy (apps/cache), provider URL builders and React component/hook tests (packages/micro-image-image), or docs-app tests (apps/docs). Load before adding a test file or new cases, before deciding what to stub, and ALWAYS before changing or deleting a failing test — this repo pins every known bug with a paired characterization test and an `it.fails` ledger test, and deleting one to make CI green destroys the bug backlog. Covers the ledger convention, per-package vitest setup, the jsdom opt-in, and the stub helpers.
---

# Testing

The suite is **green on purpose**. Every known bug is pinned by two tests, so CI stays green
until a bug is actually being fixed — and then goes red to tell you exactly what to do next.

**Read `BUGS.md` first.** It is the canonical description of the ledger convention and the
bug table itself. Don't duplicate it here; it lives at the repo root because it's for humans
too.

`conventions.md` next to this file covers the mechanical setup: package layout, the jsdom
opt-in, and the stub helpers.

## The one rule that matters

A failing `it.fails` test means **someone fixed a bug**. Retire it properly:

1. Fix the code.
2. CI fails on the `it.fails` ledger test for that bug.
3. Change `it.fails` to `it`.
4. Delete the matching characterization test — it now documents a lie.
5. Update the row in the `BUGS.md` table.

**Never delete a ledger test to make CI pass.** It is not a broken test; it is a to-do item
that has come due.

## The pairing

Each bug gets both:

```ts
// characterization — what the code does TODAY. Keeps CI green, catches regressions
// while refactoring. Tagged with the bug number.
it("emits blur=false on every url that does not ask for blur [BUG-5]", () => {
  expect(generateUrl({ url: URL_BASE, src: SRC })).toBe(`${URL_BASE}?image=...&blur=false`);
});

// ledger — what the code SHOULD do. Vitest inverts it: passes while the assertion
// fails, fails the moment the assertion starts passing.
it.fails("BUG-5: blur should be absent from the url when not requested", () => {
  expect(generateUrl({ url: URL_BASE, src: SRC })).not.toContain("blur");
});
```

Writing a new test for behavior that is currently wrong? Write the pair, and add the row to
`BUGS.md`. Writing a test for behavior that is correct? Just write the test.

## When a test contradicts a bug report

Follow what is measured, not what was reported. Three entries in the original report did not
survive contact with a test, and the suite corrected them — `BUGS.md` § Corrections records
each one and why. Do the same: if a report says `NaN` and the code produces `0`, the test
asserts `0`, and the correction gets written down.
