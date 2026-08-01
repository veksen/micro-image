---
status: proposed
---

# Bundler coverage is whatever `unplugin` supports, verified per bundler before it is claimed

**Not ratified.** Open question 7 from `VISION.md`.

## Context

`unplugin` advertises Vite, Rollup, Webpack, esbuild, Rspack, and Rolldown. The `?micro`
module loader is a plain module transform and should work anywhere `unplugin` does.

The AST transform side is less certain. Turbopack and Rspack have their own plugin execution
models, and "unplugin supports it" is a claim about the adapter layer, not about whether a
JSX transform hooked into that layer behaves identically.

Claiming support that hasn't been exercised is worse than claiming less. An image plugin that
silently no-ops under Turbopack produces pages that look fine and are slow — the failure is
invisible until someone measures.

## Decision (proposed)

Support what `unplugin` supports for the **loader**. For the **transform**, claim a bundler
only once an integration test builds a real fixture project under it and asserts the output
contains the rewritten import. Untested bundlers are documented as untested, not as broken
and not as working.

## Consequences

- The support matrix in the README is evidence-backed, and each row is a test someone can run.
- Adding a bundler costs a fixture project and a CI job, which is real but bounded work.
- Early releases will claim fewer bundlers than `unplugin` technically covers. That is the
  intended trade — the alternative is a matrix nobody has verified.
- Not blocking. This ADR gates what the README claims, not what gets built. Milestone 5 can
  ship with Vite verified and everything else marked untested.
