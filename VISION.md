# micro-image — Vision

## North star

> Write `<Image src="./hero.jpg" />` and get the correct-sized, format-optimized image
> for the container it renders into — starting from the HTML alone, with no placeholder
> round trip, no manual dimensions, no framework lock-in.

The user should never type a query-string suffix, never hardcode width/height, and never
wait on JavaScript for the browser to start the right variant. JavaScript may refine a choice
the HTML already made; it never makes the first one. **Container-width–driven selection is
the core feature and must stay.**

## Who it is for, in order

1. **The maintainer's own sites**, including Query Doctor's. A feature none of them needs
   waits.
2. **Developers who self-host.** The packages are open source and the proxy runs anywhere.
   Self-hosting is the default and stays fully supported.
3. **A paid hosted proxy, later.** The open-source proxy, operated for people who don't want
   to run it. It is a deployment, not a fork: every hosted feature exists in the self-hosted
   proxy too. It takes no payment before the URL contract is frozen at 1.0, because a
   customer's pages store those URLs.

## What wins a trade-off, in order

When two of these conflict, the higher one wins. Say which one lost in the PR.

1. **Trust.** The code does what the docs say. URLs and props do not change without a
   changeset. No framework adapter or launch ships before the core is stable.
2. **Speed.** How fast an image loads end to end: the component's markup, the browser's
   variant choice, and the proxy's response. This is the top workstream. Any part of the
   stack can be replaced, the proxy's language included, but only when a benchmark shows the
   replacement is faster.
3. **Ease.** One import and a `src`. Ease is close to speed and loses only on a real
   conflict. Example: the build plugin is an extra install step, accepted because it removes
   a request from the critical path.

Visibility and revenue are not values here. Decide on the three above.

The packages stay on `0.0.x` until the API is ready to freeze, so breaking changes ship now,
before outside users depend on them. On `0.0.x` a design decision is an experiment: the
benchmark picks between candidates, and a better measurement reverses an earlier choice.

## Dogfooding Query Doctor

Run Query Doctor on any change that adds or alters a database (schema, queries,
migrations), and record the result in the PR, useful or not. The PR does not merge before
that. micro-image has no database today. A hosted proxy would likely add one, for accounts
and usage metering.

## Why this exists

Existing responsive image solutions each miss at least one axis:

| Solution          | Container-width driven | No hardcoded dimensions | No runtime round trip | Framework-agnostic | Self-hosted proxy |
| ----------------- | ---------------------- | ----------------------- | --------------------- | ------------------ | ----------------- |
| `next/image`      | no (viewport)          | yes (static import)     | for statics           | no (Next only)     | no                |
| `@unpic`          | no (viewport)          | partial                 | yes                   | yes                | pluggable         |
| `astro:assets`    | no (viewport)          | yes                     | yes                   | no (Astro)         | no                |
| `vite-imagetools` | no                     | manual                  | yes                   | Vite only          | no                |
| `<img srcset>`    | no                     | yes                     | yes                   | yes                | no                |
| **micro-image**   | **yes**                | **yes**                 | **yes**               | **yes**            | **yes**           |

The differentiator is **container-width selection + self-hosted proxy + framework-agnostic**.
All three, or it is just another image library.

Neither half of container-width selection is new. `sizes="auto"` is a browser feature, and
lazysizes has measured elements to set `sizes` since about 2014. micro-image combines them:
build-time metadata puts a real `srcset` and `sizes` in the first paint, and a
`ResizeObserver` can only raise it.

## Architecture — three layers, one contract

### The `ImageMeta` contract

Every path — build-time static, runtime dynamic, framework-specific — produces the same
shape the component consumes:

```ts
interface ImageMeta {
  src: string; // canonical URL or emitted asset URL
  width: number; // intrinsic pixel width
  height: number; // intrinsic pixel height
  srcset: string; // capped at intrinsic width
  placeholder?: string; // data-URI LQIP or blurhash
  sizes?: string; // initial sizes baked at build; an observer may only raise it
}
```

The component accepts each field as an **optional prop**. Present → use it. Missing → fetch
it at runtime from the proxy `?meta` endpoint. This invariant is what lets one component
serve both the static-optimized and the dynamic path. See
`.claude/skills/image-meta-contract/`.

### The three layers

```
        <Image src="./hero.jpg" />        <Image src={userUrl} />
                    │                              │
      ┌─────────────┼──────────────────────────────┤
      │             │                              │
 (build-time)  (runtime, dynamic)          (runtime, no proxy)
      │             │                              │
 unplugin +    proxy ?meta endpoint          sizes="auto" +
 ?micro loader injects dimensions            native srcset
 injects full  + placeholder at              container-width
 ImageMeta     runtime                       selection at layout
      │             │                              │
      └─────────────┴──────────────────────────────┘
                    │
         Image proxy (resize, format, cache)
         Providers: micro-image, ipx, imgproxy, …
```

### How container-width selection works

The build knows the **image**. The layout knows the **container**.

- **Build time** emits `ImageMeta`: intrinsic dimensions (a reserved box, so no CLS and no
  typed dimensions), a `srcset` capped at intrinsic width, an inline LQIP, and an initial
  `sizes`.
- **First paint** carries that `srcset` and `sizes` in the HTML, so the preload scanner
  starts the image before any JavaScript runs. This works on the hero image too, because it
  does not depend on `loading="lazy"`.
- **At runtime** a `ResizeObserver` may raise `sizes` when the container is wider than the
  bake assumed. It never lowers it (see below).

`sizes="auto"` alone cannot do this. It needs `loading="lazy"`, because container width
exists only after layout and the preload scanner runs before it. It trades early discovery
for accuracy, which is the wrong trade for the largest image on the page.

**No jumping comes from the reserved box, not from the variant.** Build-time dimensions give
every image an `aspect-ratio` box before any byte arrives. Lazy or eager, small or large
variant, the content around it does not move.

**Lazy and eager split the problem.** A lazy image loads after layout, so `sizes="auto"` gives
it the exact container width with no JavaScript and no guess. An eager image, the one or few
above the fold, has to start before layout, so only eager images need a baked `sizes`.

**The baked `sizes` is load-bearing.** Measured by the browser benchmark in Chromium on
2026-10-13:

- **Baked too large costs bytes no observer recovers.** Once the large candidate has loaded,
  Chromium keeps it when `sizes` is lowered. While it is still downloading, a lowered `sizes`
  starts the smaller candidate and does not cancel the large one: 213 KB instead of 175 KB for
  a 768px column on a throttled 10 Mbps link. So an observer only ever raises `sizes`.
- **`100vw` is too large outside full-bleed layouts.** An eager `100vw` image overfetched 2.5×
  in a column, 3× in a grid cell and 8× as a thumbnail.
- **A viewport-only bake cannot close that gap.** Closing it takes layout knowledge: CSS read
  at build, a `sizes` written by the developer, or widths learned from traffic.

Until the build can read layout, an eager image takes a `sizes` from the developer and falls
back to the viewport capped at intrinsic width. A bake that errs small, raised by the
observer, is not measured yet. Safari and Firefox are not measured yet.

### Shared core, thin adapters

The build-time plugin ships as **`unplugin`** (Vite, Rollup, Webpack, esbuild, Rspack,
Rolldown). The core owns the `?micro` module loader, the cache layer, the `ImageMeta` codec,
and config resolution — with zero framework knowledge.

Each framework package does exactly one thing: **find `<Image>` elements whose import
binding resolves to `@micro-image/image`, and rewrite them to hoist a `?micro` import and
spread its result.** File reading, sharp, caching, and LQIP never leak into an adapter.

Binding detection uses the parser's own scope/binding API — never hand-rolled data-flow
analysis. Bias toward **precision, not recall**: never transform what you cannot prove is
yours. This is safe because a missed static resolution degrades to a `?meta` fetch, so the
transform is a pure optimization.

## Non-goals

- **Not a CDN.** The open-source proxy resizes and caches; it does not do global edge
  delivery. Put a real CDN in front of it if you want offload. How the hosted proxy delivers,
  and who pays for bandwidth, is decided when the hosted proxy starts.
- **Not a rewrite of `next/image`.** No layout modes, no `fill`, no intrinsic/responsive
  interplay. `aspect-ratio` from build-time dimensions, plus a `srcset` and `sizes` in the
  first paint, covers 95% of what those APIs bolt on.
- **Not eliminating the proxy for static images.** Keeping the proxy authoritative avoids
  duplicating resize logic and lets one deployment serve static and dynamic uniformly.
- **Not importing non-local URLs at build.** That would make CI depend on the external network.
- **Not shipping framework packages until the shared core stabilizes.** React first, then
  Vue/Svelte/Astro, then Solid/Preact.

## Success criteria

**In twelve months**, each of these is measured and true:

- **Works well.** It serves every image on the maintainer's sites in production, with no open
  correctness bug in `BUGS.md` that a consumer could hit.
- **Faster**, on three layers, each against a named alternative:
  - **Proxy:** latency and throughput per transform, cold and warm, against imgproxy on the
    same hardware and fixtures.
  - **Component:** bytes served for the same container and source against `next/image`,
    and no JS-gated request for static images.
  - **End to end:** time until the image is painted (LCP when it is the largest element) on a
    real page, against `next/image` and a plain `<img srcset>`.
- **No jumping.** Every image reserves its box from build-time dimensions: zero layout shift
  from images, lazy or eager.
- **Easy.** A local image goes from install to optimized with one package, one plugin line,
  and `<Image src alt />`. No width, height, or `sizes` typed by hand.

**The north star** is hit when all of these are true:

- A consumer writes `<Image src="./hero.jpg" alt="…" />` in React, Vue, Svelte, or Astro,
  installs the plugin, and gets an image that loads only the variant matching its container,
  ships an inline placeholder, has zero CLS, and never triggers a JS-gated round trip.
- The same consumer writes `<Image src={dynamicUrl} />` and gets the same behavior with one
  additional small JSON request — nothing else changes.
- The proxy negotiates AVIF/WebP on `Accept`, coalesces concurrent requests, and stays
  memory-bounded under load.
- All framework packages share one core; adding a framework is hundreds of lines, not thousands.

## Open decisions

Ten design questions are unresolved and tracked as ADRs in `docs/adr/` (`0002`–`0011`).
Resolve one before writing code that assumes an answer.

Nine are `proposed`. `0003` (srcset ladder) is `blocked`: its cost model was arithmetic rather
than measurement, and checking it inverted the answer. It stays blocked until the benchmark
supplies a bytes-vs-width curve over real content and codecs. Prefer a blocked ADR to a
plausible one — a decision recorded on an assumption is harder to dislodge later than an
open question.
