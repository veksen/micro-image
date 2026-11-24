---
"@micro-image/image": minor
---

Stop sending `quality=75` to the micro-image proxy when the caller sets no quality.

The proxy picks a quality per output format: 75 for JPEG and WebP, 50 for AVIF. `<Image>` always
sent 75, which overrode the AVIF default, so a browser that negotiated AVIF got a file larger than
the WebP it would otherwise have received. micro-image URLs now carry `quality`
only when `generatorOptions` sets one.

The ipx and imgproxy providers are unchanged: `<Image>` still sends 75 to them.
