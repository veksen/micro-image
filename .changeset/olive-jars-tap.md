---
"@micro-image/image": patch
---

Stop downloading a full-size copy of every image and throwing the bytes away.

`Image` called `useImage` with a URL carrying no width, which is the largest variant the proxy
will produce, and then read nothing from it but `error`. Every rendered image paid for that
download on top of the variant it actually displayed.

Error detection no longer needs it. The rendered `<img>` now reports its own failure through
`onError`, so the component observes the request it was already making. The `useImage` hook is
deleted; it was internal and never exported from the package entry.

Two defects went with it. The hook's cleanup called `removeEventListener` against handlers
assigned as `onload` / `onerror` properties, which cannot detach them. Its `loaded` and
`fetching` return values were computed on every load and read by nobody.

Failure state is now tracked as the src that failed rather than a boolean, so pointing the
component at a different image retries instead of rendering nothing forever. A failing
placeholder now hides the image, where it previously left a broken one on the page.
