---
status: proposed
---

# The srcset ladder is a fixed set, clamped to intrinsic width

**Not ratified.** Open question 2 from `VISION.md`.

## Context

Every path that produces `ImageMeta` has to decide which widths go in `srcset`. Two options:

- **Fixed ladder** — the same widths for every image, e.g.
  `[320, 480, 640, 800, 1024, 1280, 1600, 1920, 2400]`, clamped so no entry exceeds the
  image's intrinsic width.
- **Derived per image** — widths computed from each image's own intrinsic width, e.g. even
  fractions of it.

The proxy caches by URL. A fixed ladder means a 640px variant of any image is requested at
exactly 640, so unrelated pages share cache entries and a cold proxy warms up quickly. A
derived ladder produces near-unique widths per image and fragments the cache.

Today the component does neither correctly: it generates 20 hardcoded entries at 100px
intervals with no clamping, so a 900px source advertises variants up to 2000w. That is
BUG-10's neighborhood and vision milestone 1 fixes it.

## Decision (proposed)

**Fixed ladder, clamped to intrinsic width.** The ladder is configurable, but the default is
shared across every image in a project.

## Consequences

- Cache hit rate is materially better, which matters most on a self-hosted proxy that has no
  CDN in front of it by default.
- Some images get a slightly worse fit than a derived ladder would give — a 700px-wide source
  clamps to `[320, 480, 640]` and never offers 700. The browser picks 640 and upscales 9%,
  which is imperceptible and cheaper than a cache miss.
- Clamping is mandatory, not optional. An entry wider than the source asks the browser to
  download an upscale, which is strictly worse than not offering it.
- The ladder becomes part of the cache key surface: changing it invalidates every cached
  variant. Treat a ladder change as a deployment concern, not a config tweak.
