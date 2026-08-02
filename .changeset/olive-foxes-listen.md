---
"@micro-image/image": patch
---

Document `avif` as a format the proxy will encode to.

`?format=avif` now returns an AVIF, so the readme's list of accepted `format` values was
missing one and the `quality` bullet described a rule that no longer holds on its own.

The readme also now warns about the interaction that makes AVIF a footgun here: the proxy
encodes AVIF at quality 50 when a request names no quality, but `<Image>` always names one,
defaulting to 75. AVIF at 75 is larger than the JPEG it replaces, so a caller asking only for
`format: "avif"` gets a regression unless it passes `quality: 50` as well.

npm always ships `README.md`, so this patch exists to publish the corrected file.
