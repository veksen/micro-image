---
status: proposed
---

# Placeholders are inline data URIs, with blurhash as an opt-in

**Not ratified.** Open question 1 from `VISION.md`. The suggested default is recorded here so
it can be argued with, not so it can be assumed.

## Context

`ImageMeta.placeholder` holds a low-quality image placeholder shown while the real variant
loads. Two encodings are viable and they trade off against each other:

- **Data URI** — a tiny base64 JPEG, roughly 200–400 bytes. Renders instantly as an `<img>`
  `src`. No decoder, no runtime code.
- **Blurhash** — a ~30-byte string. Six to ten times smaller on the wire, but needs a decoder
  shipped in the runtime component and a canvas paint before anything appears.

The north star says nothing may sit in the critical path. A decoder is JavaScript between the
HTML arriving and the placeholder appearing — precisely what `sizes="auto"` and the
build-time path exist to eliminate.

## Decision (proposed)

Default to **data URI**. Offer blurhash as an opt-in via plugin config for consumers whose
pages carry many images and who care more about bytes than about first paint.

## Consequences

- The runtime component ships no decoder in the default path — the placeholder is just an
  `src`.
- Per-image payload grows by ~200–400 bytes, inline in the HTML or the module output. On a
  page with 50 images that is ~15KB of markup, which is when blurhash starts to pay.
- Supporting both means the codec must tag which encoding a `placeholder` carries, or the
  component must sniff it. Tagging is the lesser evil — sniffing a base64 string is guesswork.
- Ties into `0006`: if metadata is injected as a single `_micro` prop, the tag rides along for
  free; if it is spread as loose props, the encoding needs its own field.
