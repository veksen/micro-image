---
status: proposed
---

# The proxy decodes everything sharp can and encodes only JPEG, PNG, WebP and AVIF

**Not ratified.** Output of the research in `docs/research/image-format-coverage.md` (#37).
ADR `0004-format-policy` owns _who decides_ the output format; this ADR owns _which formats
exist to decide between_.

## Context

`supportedMimes` is `["image/png", "image/webp", "image/gif", "image/jpg", "image/jpeg"]`. That
list does two jobs at once — it gates what gets decoded, and by omission it decides what gets
passed through — and it is wrong for both.

Measured against the benchmark fixtures on sharp 0.35.3 / libvips 8.18.3:

- Every format the proxy refuses except SVG is one **sharp can already decode**. Refusing TIFF
  costs 95–99% of the achievable saving; refusing AVIF costs 84%.
- Inside the accepted list the handling is uneven. PNG is encoded losslessly, forfeiting 88–93%.
  Animated GIF and APNG are silently flattened.
- AVIF **output** costs nothing to add: aom 3.14.1 is already in the installed binary under
  BSD-2 + AOM Patent License 1.0. `formatMimes` simply does not list it.
- JXL and HEIC are unavailable on the prebuilt binary and cannot be added without self-compiling
  libvips for every target platform. JXL is additionally at 0% browser support.

A separate constraint shapes the input side: **mime alone cannot distinguish a still PNG from an
APNG, or a still WebP from an animated one.** Only the container can. So an input matrix keyed on
mime is not sufficient on its own — see ADR `0010-unimprovable-formats`.

## Decision (proposed)

**Input** — accept anything sharp can decode on this build, gated by a decode probe rather than
a mime allowlist:

| accepted | JPEG, PNG (incl. APNG), WebP (incl. animated), GIF (incl. animated), TIFF, AVIF                     |
| -------- | --------------------------------------------------------------------------------------------------- |
| refused  | SVG (passthrough — rasterising is a **-1069%** regression), HEIC, JXL, anything sharp cannot decode |

**Output** — four formats, with these settings as the defaults:

| format | setting                                   | why                                                            |
| ------ | ----------------------------------------- | -------------------------------------------------------------- |
| JPEG   | `{ mozjpeg: true, quality }`              | unchanged; the portable baseline                               |
| WebP   | `{ quality }`                             | the default target for PNG and for animation                   |
| AVIF   | `{ quality: 50, effort: 4 }`              | 39–40% smaller than mozjpeg **and** more faithful, at 3.1x CPU |
| PNG    | `{ palette: true, effort: 1, dither: 0 }` | only when the client cannot accept WebP                        |

**Not emitted:** GIF (animated GIF re-encode is 73 s and 221 MB for one 100-frame 1080p request —
a one-request denial of service), HEIC, JXL.

Rationale for the settings that look arbitrary:

- AVIF `effort` 0 and 2 produce **larger** files than effort 4, because aom's fastest presets
  disable the rate-distortion search. Effort 9 costs 39–69x mozjpeg for a 0.8% gain over effort 4.
  Effort 4 is the only defensible point on a cold path; effort 6 is defensible only behind a warm
  cache.
- PNG `effort: 7` (sharp's default) buys 4 points of saving for **30x** the encode time.
- PNG `quality` is inert on photographic content — every value from 60 to 100 produced
  byte-identical output. It is not a knob; `effort` and `colours` are.

## Consequences

- The decode probe replaces `isSupported()` as the gate. That is a behaviour change on every
  request whose upstream mime is currently unlisted, and it makes `supportedMimes` an output
  concern only.
- AVIF joins `formatMimes` and becomes reachable via `?format=avif`. Under ADR 0004 it also
  becomes the preferred negotiated output — but that ADR is unratified, so `?format=` is the only
  way to reach it until then.
- PNG output changes for every PNG request. `png({ palette: true })` is lossy — it quantises to
  an indexed palette. This is the trade this ADR accepts: 88–93% fewer bytes for a measured RMSE
  of 6–8.4. It is reversible per-request only if a "lossless PNG" escape hatch is added, which
  this ADR does not propose.
- **The dither choice is not settled by the measurements.** RMSE penalises dither noise, so
  `dither: 0` scores best on the metric while being the config most prone to visible banding on
  smooth gradients, and the fixture is high-frequency by design. Ratifying this ADR should not be
  read as ratifying `dither: 0` on visual grounds.
- We stay on the prebuilt `@img/sharp-libvips-*` binaries. That is the real reason JXL and HEIC
  are out, and it is a constraint worth defending: a self-compiled libvips per platform is a
  hosting and upgrade burden this project has no capacity for.
- HEIC input needs an explicit refusal, not a capability probe. `metadata()` **succeeds** on a
  real HEVC-coded HEIC and even reports `compression: "hevc"` — only pixel access fails. A probe
  built on `metadata()` would report support that does not exist.

## Alternatives rejected

- **Keep PNG lossless.** Defensible only if PNG is assumed to mean "the author wanted exact
  pixels". The proxy already resizes and re-encodes, so that assumption is not held anywhere else
  in the pipeline.
- **Emit palette PNG as the primary small-image format.** WebP beats it on all three axes — 4–10x
  fewer bytes, better fidelity, bit-exact alpha, comparable CPU. Palette PNG only earns its place
  as the fallback for clients that do not accept WebP.
- **Add JXL behind a custom libvips.** 0% browser support (`usage_perc_y`) makes this
  unjustifiable regardless of build cost.
