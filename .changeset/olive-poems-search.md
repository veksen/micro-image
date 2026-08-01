---
"@micro-image/image": minor
---

Emit the blur radius instead of a boolean, and stop overriding a caller's `quality`.

`generateUrl` for the `micro-image` provider coerced `blur` with `Boolean()`. That
discarded the radius, so `blur: 5` and `blur: 40` produced the same URL, and it emitted
`blur=false` on every URL that never asked for blur. The radius now reaches the proxy, and
the parameter is absent when unset.

`<Image>` spread its hardcoded `quality` after `generatorOptions`, so a caller passing
`quality` had it silently replaced with 75. Caller values now win, and 75 remains the
default.

URLs generated for the same props change shape. Nothing carries `blur=false` any more, and
`blur` is a number when present.
