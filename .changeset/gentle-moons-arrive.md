---
"@micro-image/image": minor
---

Emit `srcset` and `sizes` on the first paint, so the browser's preload scanner can start the
real image.

Both attributes used to be written imperatively from inside a `ResizeObserver` callback, so
nothing but the blurred placeholder existed until HTML parsed, React hydrated, the effect ran
and the observer fired. `<img>` now receives `srcSet` and `sizes` as React props, which also
ends the second half of the defect: a re-render touching the element wiped the observer's DOM
writes and the observer had to fire again to restore them.

`sizes` defaults to `auto, 100vw` and the image now loads lazily, because `sizes="auto"` — the
browser choosing a candidate from the element's own laid-out width, with no JavaScript — is
only honoured on a lazily loaded image. Browsers without support for the keyword skip it and
read the `100vw` bound, then narrow to the measured container width when the observer reports
it.

Two new optional props: `sizes` overrides the computed value and switches the observer off,
and `loading` takes `eager` for an image above the fold, which must not be deferred.

One visible change: the blurred placeholder no longer renders. `srcset` supersedes `src`, so a
browser that understands it never requests the placeholder URL — one fewer round trip per
image, and the direction `VISION.md` already sets. `src` still carries the placeholder for
browsers without `srcset`.
