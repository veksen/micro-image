# micro-image — Vision

## North star

> Write `<Image src="./hero.jpg" />` and get the correct-sized, format-optimized image
> for the container it renders into — with no runtime measurement, no placeholder round
> trip, no manual dimensions, no framework lock-in.

The user should never type a query-string suffix, never hardcode width/height, and never
wait on JavaScript for the browser to pick the right variant. **Container-width–driven
selection is the selling point and must stay.**

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
  sizes?: string; // optional viewport-based hint for above-the-fold
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

- **Not a CDN.** The proxy is self-hosted; put a real CDN in front of it if you want offload.
- **Not a rewrite of `next/image`.** No layout modes, no `fill`, no intrinsic/responsive
  interplay. `aspect-ratio` + `sizes="auto"` covers 95% of what those APIs bolt on.
- **Not eliminating the proxy for static images.** Keeping the proxy authoritative avoids
  duplicating resize logic and lets one deployment serve static and dynamic uniformly.
- **Not importing non-local URLs at build.** That would make CI depend on the external network.
- **Not shipping framework packages until the shared core stabilizes.** React first, then
  Vue/Svelte/Astro, then Solid/Preact.

## Success criteria

The north star is hit when all of these are true:

- A consumer writes `<Image src="./hero.jpg" alt="…" />` in React, Vue, Svelte, or Astro,
  installs the plugin, and gets an image that loads only the variant matching its container,
  ships an inline placeholder, has zero CLS, and never triggers a JS-gated round trip.
- The same consumer writes `<Image src={dynamicUrl} />` and gets the same behavior with one
  additional small JSON request — nothing else changes.
- The proxy negotiates AVIF/WebP on `Accept`, coalesces concurrent requests, and stays
  memory-bounded under load.
- All framework packages share one core; adding a framework is hundreds of lines, not thousands.

## Open decisions

Seven design questions are unresolved and tracked as ADRs in `docs/adr/` (`0002`–`0008`).
Resolve one before writing code that assumes an answer.

Six are `proposed`. `0003` (srcset ladder) is `blocked`: its cost model was arithmetic rather
than measurement, and checking it inverted the answer. It stays blocked until the benchmark
supplies a bytes-vs-width curve over real content and codecs. Prefer a blocked ADR to a
plausible one — a decision recorded on an assumption is harder to dislodge later than an
open question.
