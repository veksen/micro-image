# micro-image

An end-to-end responsive image stack: a self-hosted proxy, a framework-agnostic `<Image>`
component, and a planned build-time plugin, all agreeing on one description of an image.

## Language

### Images and metadata

**`ImageMeta`**:
The description of one image that every acquisition path produces and the component
consumes: where it lives, its intrinsic size, its srcset, and optionally its LQIP and sizes.
_Avoid_: image data, image info, image metadata

**Acquisition path**:
One of the three ways an `ImageMeta` is obtained: build-time (static import), runtime
(the proxy's `?meta` endpoint), or no-proxy (native srcset, with `sizes="auto"` for lazy
images).
_Avoid_: mode, strategy, flow

**Intrinsic width**:
The pixel width of the source image itself, before any resize.
_Avoid_: natural width, original width, max width

**Variant**:
One resized, re-encoded rendition of a source image, at one width and one format.
_Avoid_: version, size, rendition

**srcset ladder**:
The set of widths offered as variants in `srcset`, never wider than the intrinsic width.
_Avoid_: breakpoints (a CSS concept)

**Container-width selection**:
The browser choosing a variant from the width of the element the image renders into, not
the viewport.
_Avoid_: responsive images, viewport selection

**LQIP**:
The inline low-quality placeholder shown before the chosen variant loads.
_Avoid_: blur, thumbnail, preview

### Serving

**Proxy**:
The self-hosted server that resizes, re-encodes, and caches variants on request.
_Avoid_: CDN, provider, image service

**Provider**:
A URL builder that speaks one proxy's URL grammar, such as `micro-image`, `ipx`, or
`imgproxy`. A provider runs in the browser or build; it never serves bytes.
_Avoid_: proxy, backend, loader

### Build-time plugin

**Core**:
The framework-agnostic half of the build-time plugin, which knows how to turn a source file
into an `ImageMeta` and knows nothing about any framework.
_Avoid_: plugin, engine

**Adapter**:
A framework-specific package that finds `<Image>` usages and rewrites them to use the core,
and does nothing else.
_Avoid_: plugin (ambiguous between core and adapter), integration

### Bug tracking

**Characterization test**:
A test that asserts what the code does today for a known bug, so a change in behavior is
noticed.
_Avoid_: snapshot test, regression test

**Ledger test**:
A test that asserts what the code should do for a known bug, and is expected to fail until
the bug is fixed.
_Avoid_: todo test, skipped test, pending test
