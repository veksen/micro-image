---
"@micro-image/image": minor
---

Emit `srcset` and `sizes` on the first paint, so the browser can pick and start the image
without waiting for JavaScript.

Both attributes used to be written from a `ResizeObserver` callback after mount, so the first
paint carried only the blurred placeholder. `<img>` now receives `srcSet` and `sizes` as props,
and the observer is gone.

Images now load lazily by default with `sizes="auto"`, which lets the browser pick a candidate
from the element's own laid-out width. Browsers without `auto` read the fallback after it: the
viewport, capped at the image's intrinsic width.

Two new optional props. `loading="eager"` is for an image above the fold. Pass `sizes` with it:
an eager image without one falls back to the viewport, which overfetches whenever the image is
narrower than the viewport.

The blurred placeholder no longer renders in browsers that support `srcset`, because `srcset`
supersedes `src`. `src` still carries it for browsers without `srcset`.

`srcset` now stops at the image's intrinsic width (still at most 1900w). A dense display used
to request wider candidates the proxy could not fill, each one a separate encode and cache
entry.
