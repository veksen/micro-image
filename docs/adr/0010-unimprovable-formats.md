---
status: proposed
---

# Formats we cannot improve are cached and passed through, never flattened

**Not ratified.** Output of the research in `docs/research/image-format-coverage.md` (#37).
Companion to ADR `0009-format-matrix`, which decides which formats exist; this one decides what
happens to the ones the proxy accepts but cannot make smaller.

## Context

The proxy has two ways of handling an input it cannot improve, and it currently picks the wrong
one in both directions.

**When it refuses**, it passes the bytes through _and does not cache them._ Measured: two
requests for a passthrough response produce **two origin fetches**, forever. The upstream
`content-type` is relayed with no validation. That is #10 / BUG-21, and it compounds with the
byte problem — the response the proxy is worst at (78 kB of unresized TIFF, 95% above what it
could serve) is also the one it refetches every time.

**When it accepts**, it flattens. An APNG arrives labelled `image/png` — because it _is_ a PNG,
and every mime table maps `.png` to `image/png` — takes the PNG branch, and comes out as a still.
12 frames in, 1 out, 97.9% of the bytes discarded, no error and no warning event. Animated WebP
has no guard at all. Animated GIF has a guard that does not fire, because it looks for the
Graphics Control Extension at an offset where every looping GIF puts a NETSCAPE 2.0 Application
Extension instead.

Flattening is worse than either passthrough or refusal, because it is silent and lossy and the
result gets cached. **Precision over recall**, from the vision digest: a missed optimisation
degrades gracefully, a wrong one corrupts.

The structural cause is that the policy is keyed on mime, and **mime cannot express animation**.
Only the container can: `acTL` before the first `IDAT` for PNG (PNG 3rd ed §11.3.6.1), and
`metadata().pages > 1` for GIF, WebP and TIFF.

## Decision (proposed)

Three rules, in order.

**1. Never flatten.** An input carrying more frames than the output format can hold is either
transcoded to a format that can hold them, or passed through unchanged. It is never silently
reduced to frame 1. Animation is detected from the container, not the mime:

- PNG → scan for an `acTL` chunk before the first `IDAT`.
- GIF, WebP, TIFF → `metadata().pages`, which is populated on a **default** load and needs no
  full decode.

This retires the fixed-offset parsing in `is-animated-gif.ts` — the surface that produced BUG-18
and its unfixed mirror image.

**2. Passthrough is a cached outcome, not an uncached one.** Anything returned unchanged is
written to the cache with the same key discipline as a transformed response, so an unimprovable
input costs one origin fetch, not one per request. The relayed `content-type` is validated
against what the bytes actually are rather than trusted from upstream.

**3. Transcode when it wins, passthrough when it does not, refuse only when we cannot decode.**

| input                  | policy                        | why                                                                         |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| animated GIF           | transcode → animated WebP     | 12x smaller than re-encoded GIF, 15x faster                                 |
| animated WebP          | resize in place, stay WebP    | already the target format                                                   |
| APNG                   | passthrough unchanged         | libvips cannot decode _or_ encode APNG — there is nothing to transcode with |
| TIFF, AVIF input       | transcode                     | sharp decodes both; 84–99% saving                                           |
| SVG                    | passthrough                   | rasterising a 162-byte vector to 1.9 kB is a **-1069%** regression          |
| HEIC, JXL, undecodable | refuse, passthrough unchanged | no decoder on the prebuilt binary                                           |

## Consequences

- **APNG passthrough is a deliberate non-optimisation.** libvips has no APNG code in either
  direction (zero matches for `acTL|APNG|animat` across `vipspng.c`, `pngload.c`, `spngload.c` at
  v8.18.3), so the only options are "pass it through" or "destroy it". Serving the original bytes
  unresized is the correct answer until an APNG-capable encoder exists, and it should be
  documented as such rather than left looking like an oversight.
- Detecting animation before deciding means a container probe on every PNG and WebP request. The
  `acTL` scan is bytes-before-`IDAT` only; `metadata().pages` is a header read. Neither is a full
  decode, but both are new per-request work on the hot path.
- Caching passthrough responses changes the cache budget. `retainedBytesPerEntry` in the committed
  benchmark already flags passthrough as the worst offender, and this decision makes it worse
  before rule 3 makes it better — **fixing #10 alone would lock un-optimised bytes into the
  cache.** The two must land together, or transcoding must land first.
- Animated transcode needs a resource ceiling _before_ it ships. libvips holds an animation as one
  `width × (pageHeight × pages)` image, so memory scales with pixels x frames and **not** with
  encoded bytes — a GIF's compression ratio is exactly the wrong signal to gate on. The gate-able
  quantity available before decoding is `metadata()` → `width × pageHeight × pages`. This is a
  hard dependency on #7; a 100-frame 1080p GIF is 221 MB and 73 s if the ceiling is missing.
- Validating the relayed `content-type` closes BUG-22 but changes what the proxy returns for
  mislabelled upstreams, which is currently observable behaviour.

## Alternatives rejected

- **Refuse what we cannot improve (415).** Breaks images that render fine today for no user
  benefit. The proxy sits in the critical path of `<img src>`; a 415 is a broken image.
- **Flatten animation deliberately and document it.** Rejected on the vision's precision-over-recall
  rule. It also produces a frame the author may never have intended to be shown standalone — PNG
  3rd ed §11.3.6.1 notes the static image is only part of the animation if an `fcTL` precedes
  `IDAT`.
- **Re-encode animated GIF as GIF.** Measured at 73 s and 221 MB for one 100-frame 1080p request
  at sharp's default effort, still 12x larger than animated WebP. `effort: 1` is 4.6x faster and
  still unusable cold.
