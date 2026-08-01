---
status: proposed
---

# Build-time metadata is injected as a single `_micro` prop

**Not ratified.** Open question 5 from `VISION.md`.

## Context

The AST transform rewrites `<Image src="./hero.jpg" />` to pass build-time metadata. How that
metadata arrives is a public-surface decision:

- **Spread** — `<Image {..._micro0} />`. Idiomatic, and each field is a normal optional prop.
  But every field shows up individually in devtools, and a consumer-supplied prop of the same
  name silently collides depending on spread order.
- **Single prop** — `<Image _micro={_micro0} />`. Opaque in devtools, but one name to reserve
  and no collision surface.

The contract already says the component accepts each field as an optional prop, because the
runtime `?meta` path fills them in. So this is really a question about the *build-time* path's
injection, not about the component's public API.

## Decision (proposed)

Inject a **single `_micro` prop**. The component destructures it internally and merges it
under any explicitly-passed prop, so a consumer writing `width={800}` always wins.

## Consequences

- One reserved name instead of six. Precedence is explicit and testable rather than dependent
  on JSX spread order.
- Devtools show `_micro={…}` instead of readable fields, which is worse for debugging. A dev
  build can expand it if that becomes painful.
- The component gains a merge path — `_micro` under explicit props under `?meta` fetch — that
  needs its own tests. That precedence order is the thing most likely to be got wrong.
- Interacts with `0002`: a single prop gives the LQIP encoding tag somewhere natural to live.
