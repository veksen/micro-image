---
status: accepted
---

# Build-time metadata is injected as a single `_micro` prop

Open question 5 from `VISION.md`, accepted 2026-11-23.

## Context

The AST transform rewrites `<Image src="./hero.jpg" />` to pass build-time metadata. How that
metadata arrives is a public-surface decision:

- **Spread** — `<Image {..._micro0} />`. Idiomatic, and each field is a normal optional prop.
  But every field shows up individually in devtools, and a consumer-supplied prop of the same
  name silently collides depending on spread order.
- **Single prop** — `<Image _micro={_micro0} />`. Opaque in devtools, but one name to reserve
  and no collision surface.

The contract already says the component accepts each field as an optional prop, because the
runtime `?meta` path fills them in. So this is really a question about the _build-time_ path's
injection, not about the component's public API.

## Decision

Inject a **single `_micro` prop**. The component destructures it internally and merges it
under any explicitly-passed prop, so a consumer writing `src` always wins.

`width` and `height` only set the aspect ratio, so they merge as a pair. Both written: the
written pair wins. Only one written: it is ignored and `_micro`'s intrinsic pair is used,
because mixing a written width with `_micro`'s height would distort the box.

The props type is a union. A caller writes `src`, `width` and `height`, or passes `_micro`
and may still write any of the three. Omitting both is a type error.

## Consequences

- One reserved name instead of six. Precedence is explicit and testable rather than dependent
  on JSX spread order.
- Devtools show `_micro={…}` instead of readable fields, which is worse for debugging. A dev
  build can expand it if that becomes painful.
- The component gains a merge path — `_micro` under explicit props under `?meta` fetch — that
  needs its own tests. That precedence order is the thing most likely to be got wrong.
- Interacts with `0002`: a single prop gives the LQIP encoding tag somewhere natural to live.
