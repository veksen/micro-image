---
"@micro-image/image": minor
---

Ship `srcset` and `sizes` in the server-rendered HTML wherever the slot is known before layout,
and measure the container only where it is not.

Two new optional props, `loading` and `sizes`. Images now load lazily by default.

- **Lazy images** (the default) render `srcset` with `sizes="auto"`, so the browser picks a
  candidate from the element's laid-out width. Browsers without `auto` read the fallback after
  it: the viewport, capped at `_micro`'s intrinsic width when there is one.
- **Eager images with `sizes`** render `srcset` and that `sizes` in the first paint. The browser
  starts the fetch from the HTML, with no JavaScript.
- **Eager images without `sizes`** render no `srcset` until the component has measured the box.
  It then sets `sizes` to the box width, rounded up to 100px, and only ever raises it. A
  `<noscript>` copy carries the viewport fallback for browsers without JavaScript.

The blurred placeholder is no longer requested for an eager image without `sizes`. When the
build supplies `_micro.placeholder`, that image paints it inline behind the `<img>`. In every
other case `src` still carries the blurred URL, and `srcset` overrides it in every current
browser.

`srcset` now stops at `_micro.width` when the build supplies it, and at 1900w otherwise. A
written `width` only sets the aspect ratio, so it no longer caps anything.
