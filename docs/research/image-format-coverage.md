# Image format coverage — what the proxy accepts, emits, and destroys

Research output for [#37](https://github.com/veksen/micro-image/issues/37). The decisions this
feeds are ADR `0009-format-matrix` and ADR `0010-unimprovable-formats`; ADR `0004-format-policy`
still owns _who decides_ the format.

**Machine and toolchain.** `darwin-arm64` (Apple Silicon), node `v24.18.0`, sharp `0.35.3` /
libvips `8.18.3`, prebuilt `@img/sharp-libvips-*` `1.3.2` — aom 3.14.1, heif 1.23.1, imagequant
2.4.1, libpng 1.6.58, webp 1.6.0, cgif 0.5.3, mozjpeg `0826579`. No `jxl`, `x265`, `de265` or
`openjpeg` entries.

> `BENCHMARK.md` documents cross-platform reproducibility against sharp 0.33.2 / libvips 8.15.1.
> The lockfile now resolves 0.35.3 / 8.18.3. That table is stale and its byte figures should not
> be cited as current.

All fixtures come from the `photoPixels` generator in `apps/cache/benchmark/fixtures.ts`, so byte
counts are comparable to the committed baseline. Timings are medians of 5–7 runs after a
discarded warmup. Reproduction scripts are referenced per section and were run from the repo
root; they live outside the repo and are listed in "Reproducing" at the end.

---

## Summary

Three findings are data loss, not gaps. They are the reason this research issue should not hold
its own bug fixes hostage.

| #   | Finding                                                                                     | Severity            |
| --- | ------------------------------------------------------------------------------------------- | ------------------- |
| 1   | APNG animation is silently destroyed — 12 frames in, 1 out                                  | data loss           |
| 2   | `isAnimatedGif` is a **false negative** on real looping GIFs — 30 frames in, 1 out          | data loss           |
| 3   | Animated WebP has no guard at all — same flattening, different container                    | data loss           |
| 4   | `getSmallestImage` can drop the requested width and cache the result under a `width-N` key  | correctness         |
| 5   | PNG ships lossless; palette saves 88–93%, but WebP beats palette on every axis              | missed saving       |
| 6   | Animated GIF re-encode costs 73 s / 221 MB for one request; animated WebP is 15x faster     | missed saving + DoS |
| 7   | AVIF costs nothing to add — aom is already in the binary                                    | missed saving       |
| 8   | JXL and HEIC are both unavailable on the prebuilt binary, for different reasons             | close as won't-do   |
| 9   | Passthrough forfeits 84–99% of the achievable saving _and_ refetches upstream every request | missed saving       |

---

## 1. APNG is silently flattened

**libvips has no APNG code at all.** `libvips/foreign/vipspng.c`, `pngload.c` and `spngload.c` at
tag `v8.18.3` return **zero matches** for `grep -n "acTL\|APNG\|apng\|animat"`. `vips_pngload`
takes no `n`/`page` argument, unlike `vips_gifload`.
Sources: [pngload.c](https://raw.githubusercontent.com/libvips/libvips/v8.18.3/libvips/foreign/pngload.c),
`vipspng.c`, `spngload.c`.

sharp cannot even _write_ one — a 6-frame filmstrip with `raw.pageHeight` set (metadata confirms
`pages=6` before encoding) comes out of `png()` as a single 540 px-tall stack with 0 `acTL`
chunks. So the fixture was hand-assembled per the spec and independently validated: 400x300, 12
frames, 3,858,239 bytes, chunk order `IHDR acTL fcTL IDAT (fcTL fdAT)x11 IEND`, **0 CRC
mismatches across 27 chunks**, and Pillow 12.x reads `n_frames 12, is_animated True`.

sharp reads exactly one frame, every way of asking:

| call                              | size    | `pages`   | `delay`   |
| --------------------------------- | ------- | --------- | --------- |
| `sharp(apng)`                     | 400x300 | undefined | undefined |
| `sharp(apng, { animated: true })` | 400x300 | undefined | undefined |
| `sharp(apng, { pages: -1 })`      | 400x300 | undefined | undefined |
| `sharp(apng, { pages: 12 })`      | 400x300 | undefined | undefined |

`{ animated: true }` is **not** a fix. Note `pages` is `undefined`, not `12` — unlike GIF, there
is no frame-count signal to gate on.

Through the repo's real `compress()`:

| call                                             | bytes     | `acTL`       | `fcTL` | `fdAT` | frames out |
| ------------------------------------------------ | --------- | ------------ | ------ | ------ | ---------- |
| source fixture                                   | 3,858,239 | **yes** (12) | 12     | 11     | 12         |
| `compress({contentType:"image/png", width:200})` | 82,851    | **no**       | 0      | 0      | **1**      |
| `compress({contentType:"image/png"})`            | 319,382   | **no**       | 0      | 0      | **1**      |
| `sharp(buf,{animated:true}).resize(200).png()`   | 82,851    | **no**       | 0      | 0      | **1**      |

97.9% of the bytes discarded along with the animation, no exception, no `warning` event.

**It reaches `compress()` in practice.** `image/apng` is _not_ in `supportedMimes` — but an APNG
is a PNG. Its extension is `.png`, `mime-db` maps `image/apng` only to `.apng`, and
`/etc/apache2/mime.types` has `image/vnd.mozilla.apng` **commented out** while `png -> image/png`
is live. Real APNGs arrive labelled `image/png`, `isSupported()` returns true, and there is no
guard equivalent to the `isAnimatedGif` short-circuit.

**Detection signal** — PNG Third Edition §11.3.6.1 (`acTL`, type bytes `61 63 54 4C`): _"The acTL
chunk must appear before the first IDAT chunk within a valid PNG stream."_ That is the only
reliable probe; sharp will not tell you. §4.9 and §11.3.6 cover the concepts, §11.3.6.2 `fcTL`
and §11.3.6.3 `fdAT` the frame chunks. Source: <https://www.w3.org/TR/png-3/>.

Spec note worth carrying into the fix — §11.3.6.1: _"The static image may be included as the
first frame of the animation by the presence of a single fcTL chunk before IDAT. Otherwise, the
static image is not part of the animation."_ Flattening an APNG can therefore surface a frame the
author never intended to be shown standalone.

**Browser support:** caniuse `apng` `usage_perc_y: 95` — Chrome ≥59, Edge ≥79, Safari ≥8, iOS ≥8,
Firefox ≥3. _Unresolved:_ MDN reports Edge 12, caniuse reports Edge 79 (the Chromium switch); the
discrepancy was not settled.

## 2. `isAnimatedGif` is a false negative on real GIFs

`gifDelayTime` computes the Graphics Control Extension offset as `6 + 7 + globalColorTableSize`
and requires the byte pair there to be `0x21 0xF9`. **Every looping GIF puts a NETSCAPE 2.0
Application Extension (`0x21 0xFF`) at exactly that position** — that block is how looping is
signalled — and the first real GCE sits 19 bytes later.

Verified directly against a genuine 5-frame animated GIF (`raw.pageHeight` set, `metadata()`
confirms `pages: 5, pageHeight: 48, delay: [100,0,0,0,0]`):

```
probe offset 781 bytes: 0x21 0xff 0x0b "NETSCAPE2.0"
real GCE at 800 -> off by 19
gifDelayTime: null | isAnimatedGif: false
```

Across fixtures:

| fixture                                                  | bytes      | probe offset | bytes there | first `0x21 0xF9` | `isAnimatedGif` |
| -------------------------------------------------------- | ---------- | ------------ | ----------- | ----------------- | --------------- |
| `test-helpers.makeGif({delay:10})` — what the suite uses | 66         | 25           | `0x21 0xf9` | 25                | **true**        |
| sharp `.gif({delay:50})` 800x600 x30                     | 5,861,958  | 781          | `0x21 0xff` | 800               | **false**       |
| sharp `.gif({delay:50})` 1920x1080 x100                  | 73,447,856 | 781          | `0x21 0xff` | 800               | **false**       |
| sharp `.gif({delay:50,loop:0})` 120x90 x6                | 50,600     | 781          | `0x21 0xff` | 800               | **false**       |
| sharp `.gif()` no delay 120x90 x6                        | 50,581     | 781          | `0x21 0xf9` | 781               | false           |

End-to-end through the real Fastify route at `?width=400`: **30 frames in, 1 frame out.**

The suite believes the guard works because its only fixture is a hand-built container with no
Application Extension. This is BUG-18's mirror image — that one was a false positive on JPEGs,
this one is a false negative on GIFs — and the #4 fix did not touch it.

**Caveat, stated plainly:** every fixture above was written by libvips/cgif. "Essentially all
looping GIFs" is an inference from where the GIF89a spec puts the loop block, not a measurement
across encoders. Re-verify against a real-world GIF from a different encoder before the fix
lands.

**The cheaper replacement:** `metadata()` reports `pages` and `delay` **on a default (`pages: 1`)
load** — confirmed independently (`pages: 5` without passing `animated`). No byte parsing, no
fixed offsets, and it covers WebP and TIFF too. This retires the whole `is-animated-gif.ts`
surface that produced BUG-18.

## 3. Animated WebP has no guard at all

`image/webp` is in `supportedMimes`, and the animation guard is
`upstreamContentType === gifMime && isAnimatedGif(...)` (`server.ts:271`) — GIF-only. An animated
WebP is decoded with the default `pages: 1` and re-encoded as a still. Same silent frame loss as
APNG, different container.

Confirmed mechanically: `resize()` on an image loaded **without** `animated` silently drops every
frame after the first — nothing throws, and the output is a valid single-frame file.

Conversely, `animated: true` plus a still output format is a footgun: JPEG/PNG/AVIF encode the
whole vertical strip. There is no "flatten to frame 1" behaviour — the load mode must be chosen
to match the output format. sharp's jsdoc is explicit that **"AVIF image sequences are not
supported."**

## 4. `getSmallestImage` can silently drop the requested width

A response whose upstream `content-type` is `image/png` but whose bytes are TIFF, requested with
`?width=200`, returned the **full-size 78,010-byte TIFF** labelled `image/png`. `compress()` did
run, but `getSmallestImage` preferred the original over the larger lossless PNG re-encode, so the
requested width was silently ignored and 78 kB was cached under a key claiming `width-200`.

Separately, a missing upstream `content-type` yields `application/octet-stream`, because
`reply.type(undefined)` falls back.

## 5. PNG: palette saves a lot, WebP saves more

`imageFromMime` returns `image.png()` — lossless. Its comment says _"png quality only bites with
a palette, and forcing one would change the output of every png request."_ Right about the
effect, **backwards about the mechanism**: `quality`/`effort`/`colours`/`dither` are not no-ops
without `palette`, they each _set_ `pngPalette = true` (`node_modules/sharp/dist/output.cjs:741-745`).
Passing `quality` to `png()` would silently switch the encoder into indexed mode.

**`quality` is inert on a photo.** Every quality from 60 to 100 produced byte-identical output at
each effort level, because sharp documents it as "use the lowest number of colours needed to
achieve given quality" and a photo always wants the full 256. `colours` is a 4-position knob
(bitdepth 1/2/4/8), not a continuous one — 128, 64 and 32 are byte-identical, all landing on
bitdepth 4, via `bitdepthFromColourCount` (`output.cjs:36`).

800x600 RGB -> 400w (source PNG 1,256,687 B). RMSE is per-pixel 0–255 against the lossless resize:

| config                                    | bytes   | saved     | ms p50 | RMSE     |
| ----------------------------------------- | ------- | --------- | ------ | -------- |
| `png()` **[ships today]**                 | 321,219 | 0.0%      | 11.90  | 0.00     |
| `png({palette,effort:1})`                 | 68,774  | 78.6%     | 51.52  | 10.20    |
| `png({palette,effort:7})` (sharp default) | 56,118  | 82.5%     | 371.75 | 8.50     |
| `png({palette,effort:1,colours:128})`     | 30,421  | 90.5%     | 25.86  | 25.36    |
| `png({palette,effort:1,dither:0})`        | 39,991  | 87.6%     | 42.72  | 8.39     |
| `png({compressionLevel:9})`               | 320,066 | 0.4%      | 12.88  | 0.00     |
| `webp({quality:75})`                      | 6,558   | **98.0%** | 14.22  | **5.86** |

1600x1200 -> 800w tells the same story: `png({palette,effort:1,dither:0})` 111,326 B (91.1%),
sharp's default `effort:7` 182,981 B for **1.31 s**, `webp({quality:75})` 17,220 B (98.6%) in
48 ms.

**Alpha fixture**, 800x600 RGBA -> 400w (source 1,706,561 B). Composite RMSE flattens onto
`#808080` — what a viewer actually sees — because raw RGBA RMSE is meaningless where `alpha = 0`:

| config                               | bytes   | saved | ms p50 | composite RMSE | alpha RMSE |
| ------------------------------------ | ------- | ----- | ------ | -------------- | ---------- |
| `png()` **[ships today]**            | 333,853 | 0.0%  | 15.83  | 0.00           | 0.00       |
| `png({palette,effort:1,dither:0})`   | 22,206  | 93.3% | 50.14  | 6.06           | 6.26       |
| `png({palette,effort:7})`            | 35,103  | 89.5% | 493.13 | 6.00           | 5.96       |
| `webp({quality:75})`                 | 20,652  | 93.8% | 47.61  | **3.34**       | **0.00**   |
| `webp({quality:75,alphaQuality:50})` | 9,104   | 97.3% | 23.11  | 3.57           | 5.47       |

WebP stores alpha losslessly by default (`alphaQuality` defaults to 100), so alpha survives
**bit-exactly**.

**Recommendation.** If PNG output must stay PNG: `png({ palette: true, effort: 1, dither: 0 })` —
87.6 / 91.1 / 93.3% smaller at 3.2–3.5x encode, with the best fidelity of any palette config
measured. **Do not use sharp's default `effort: 7`**: 4 more points of saving for **30x** the
encode time. But the real answer is `webp({quality:75})` — 4–10x fewer bytes than palette PNG,
better pixels, bit-exact alpha, 1.2–1.4x today's encode. Palette PNG is only for a client that
cannot accept WebP.

_Unresolved:_ RMSE penalises dither noise, so `dither: 0` scores well while being the config most
prone to visible banding on smooth gradients. The fixture is deliberately high-frequency, so
these numbers do not settle the dither choice.

**libimagequant is in the prebuilt on both target platforms** — `versions.json` reports
`imagequant 2.4.1` in `@img/sharp-libvips-darwin-arm64@1.3.2` and `@img/sharp-libvips-linux-x64@1.3.2`
(byte-identical files), the build passes `-Dquantizr=disabled`, and a live palette encode
succeeds here. No rebuild needed. Licence: BSD 2-Clause (lovell's fork; upstream libimagequant
≥2.x is GPL, which is why 2.4.1 is pinned to a fork).

## 6. Animated GIF: the only defensible target is animated WebP

libvips holds a decoded animation as one image of `width × (pageHeight × pages)` — the
"toilet roll". sharp's pixel guard compares that **total** against `limitInputPixels`
(`src/common.cc:613-614`, default `268402689`). Memory scales with pixels x frames, not encoded
bytes, so a GIF's compression ratio is exactly the wrong signal to gate on. The gate-able
quantity available before decoding is `metadata()` → `width × pageHeight × pages`.

`Rotate`, `Trim`, `Affine` and attention/entropy smart-crop **hard-fail** on multi-page input
(`src/pipeline.cc:1493`). Plain `resize({width})` is supported.

800x600, 30 frames — source 5.59 MB, target 400w:

| transform                                     | bytes     | vs source | frames out | ms p50 | peak RSS | Δ RSS |
| --------------------------------------------- | --------- | --------- | ---------- | ------ | -------- | ----- |
| passthrough                                   | 5,861,958 | 100.0%    | 30         | 0.00   | 116 MB   | 1 MB  |
| **`compress()` — today**                      | 53,289    | 0.9%      | **1**      | 241    | 143 MB   | 42 MB |
| `animated -> resize -> gif()`                 | 1,574,043 | 26.9%     | 30         | 7,190  | 171 MB   | 70 MB |
| `animated -> resize -> gif({effort:1})`       | 1,960,831 | 33.5%     | 30         | 1,167  | 167 MB   | 66 MB |
| `animated -> resize -> webp({q:75})`          | 192,010   | 3.3%      | 30         | 316    | 159 MB   | 57 MB |
| `animated -> resize -> webp({q:75,effort:0})` | 251,990   | 4.3%      | 30         | 159    | 149 MB   | 48 MB |

1920x1080, 100 frames — source 70.05 MB, target 960w:

| transform                                     | bytes      | frames out | ms p50     | peak RSS | Δ RSS  |
| --------------------------------------------- | ---------- | ---------- | ---------- | -------- | ------ |
| passthrough                                   | 73,447,856 | 100        | 0.00       | 168 MB   | 1 MB   |
| **`compress()` — today**                      | 196,167    | **1**      | 756        | 291 MB   | 125 MB |
| `animated -> resize -> gif()`                 | 19,178,504 | 100        | **73,078** | 387 MB   | 221 MB |
| `animated -> resize -> gif({effort:1})`       | 23,365,754 | 100        | 15,832     | 412 MB   | 245 MB |
| `animated -> resize -> webp({q:75})`          | 1,516,078  | 100        | 4,783      | 352 MB   | 185 MB |
| `animated -> resize -> webp({q:75,effort:0})` | 2,000,746  | 100        | 2,655      | 360 MB   | 193 MB |

**This is a resource-ceiling finding for #7.** One 100-frame 1080p GIF request costs 73 seconds
and 221 MB to re-encode as GIF at sharp's default effort — a one-request denial of service, and
eight concurrent ones would be 1.8 GB. `gif({effort:1})` is 4.6x faster and still unusable cold.
Animated WebP is 12x smaller than re-encoded GIF (1.5 MB vs 19.2 MB) and 15x faster. Note also
the floor: even passthrough holds the whole 70 MB body in memory, and today's `compress()` peaks
at 291 MB _while throwing 99 of the 100 frames away_.

`gifsave` knobs worth knowing if GIF-out is ever needed: `reuse` (default true), `effort` 1–10
(default 7), `dither`, `interFrameMaxError` (transparent unchanged pixels), `keepDuplicateFrames`.
_Correction to the issue brief:_ `reoptimise` does not exist in sharp 0.35.3 or libvips 8.18.3 —
`reuse` is its inverse-sense replacement.

## 7. AVIF: free to add, one setting worth shipping

sharp's `avif()` is a thin alias for `heif({ compression: 'av1' })` (`output.cjs:1228-1230`) —
confirmed byte-identical output. The `effort` chain, read end to end in source: sharp `effort` →
libvips `speed = 9 - effort` (`heifsave.c:600-601`) → libheif `cpu_used` → libaom
`AOME_SET_CPUUSED` (`encoder_aom.cc:1155`). aom 3.14.1 is bundled, so the full 0–9 range is live.

Source is the benchmark's 1600x1200 photo fixture as JPEG q80, resized the way `compress()`
resizes. `-> 400w`:

| encoder                               | bytes | vs mozjpeg | ms p50 | CPU x mozjpeg | RMSE     |
| ------------------------------------- | ----- | ---------- | ------ | ------------- | -------- |
| `jpeg({mozjpeg,q:75})` **[baseline]** | 8,205 | 100.0%     | 10.96  | 1.0x          | 3.76     |
| `webp({q:75})`                        | 5,774 | 70.4%      | 15.36  | 1.4x          | 4.49     |
| `avif({q:50,effort:0})`               | 6,577 | 80.2%      | 7.23   | **0.7x**      | 3.29     |
| `avif({q:50,effort:2})`               | 6,842 | 83.4%      | 13.08  | 1.2x          | —        |
| `avif({q:50,effort:4})` (default)     | 4,990 | **60.8%**  | 33.91  | 3.1x          | **2.87** |
| `avif({q:50,effort:6})`               | 4,952 | 60.4%      | 81.48  | 7.4x          | 2.87     |
| `avif({q:50,effort:9})`               | 4,950 | 60.3%      | 426.09 | **38.9x**     | —        |
| `avif({q:75,effort:4})`               | 8,663 | 105.6%     | 44.89  | 4.1x          | 2.26     |

`-> 800w` is the same shape: `avif({q:50,effort:4})` 13,435 B (60.0% of mozjpeg) at 81 ms / 3.1x,
`effort:6` 12,669 B at 8.6x, `effort:9` 12,362 B at **39.6x**.

**`avif({quality:50, effort:4})` is the only AVIF setting worth shipping** — 39–40% smaller than
mozjpeg _and_ more faithful (RMSE 2.87/2.45 vs 3.76/2.95), for 3.1x CPU. Everything else is a
trap: `effort` 0 and 2 produce **larger** files than effort 4 (aom's fastest presets disable the
rate-distortion search that makes AVIF worth using), `effort` 9 costs 39–69x for a 0.8% gain, and
`quality` above 50 is bigger than mozjpeg at both widths.

Cold self-hosted proxy: effort 4, 400w-class widths (34 ms vs 11 ms). Behind a warm cache:
effort 6 buys another 5.7% at 800w for 8.6x, amortised over every hit. Effort 9 is never
defensible.

**Note:** sharp defaults `chromaSubsampling: '4:4:4'` and always sets it explicitly, overriding
libvips' own `Q >= 90 → 444, else 420` heuristic. AVIF output is therefore **not**
chroma-subsampled by default — a size cost sharp opts into.

Licensing is clean: aom is BSD 2-Clause + AOM Patent License 1.0, already in the installed
binary. `formatMimes` (`server.ts:121-127`) simply does not list AVIF.

Browser support: caniuse `avif` `usage_perc_y: 93.4` — Chrome ≥85, Edge ≥121, Firefox ≥93 (still)
/ ≥113 (animated), Safari 16.1–16.3 partial (macOS 13+, still only), fully from 16.4; iOS ≥16.0.
For contrast, WebP is 96.07% with Chrome ≥32 / Edge ≥18 / Firefox ≥65 / iOS ≥14.

## 8. JXL and HEIC are both out

| call                                    | result                                                      |
| --------------------------------------- | ----------------------------------------------------------- |
| `sharp(buf).jxl()` / `.toFormat("jxl")` | **ERROR** `VipsOperation: class "jxlsave_buffer" not found` |
| `sharp(jxlSignatureBytes).metadata()`   | **ERROR** `Input buffer contains unsupported image format`  |
| `heif({compression:"hevc"})`            | **ERROR** `heifsave: Unsupported compression`               |
| `heif({compression:"av1"})`             | **OK** — byte-identical to `avif()`                         |

**JXL** does not exist in either direction. The prebuilt libvips is configured `-Djpeg-xl=disabled`;
sharp's own jsdoc says _"This feature is experimental… **The prebuilt binaries do not include
this**."_ Browser support is `usage_perc_y: **0**` — Chrome/Edge behind
`chrome://flags/#enable-jxl-image-format`, Firefox Nightly-only behind `image.jxl.enabled`,
Safari partial from 17.0 (still images, no progressive decoding).

**HEIC** is AVIF-only in practice: libheif is compiled `-DWITH_LIBDE265=0 -DWITH_X265=0
-DENABLE_PLUGIN_LOADING=0` — no HEVC decoder, no encoder, and no runtime plugin loading to add
one later. A genuine HEVC-coded HEIC (made with `sips -s format heic`) demonstrates the trap:

| operation                                  | result                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `sharp(heicBuf).metadata()`                | **OK** — `format=heif, 400x300, compression=hevc`                               |
| `.stats()` / `.resize().jpeg().toBuffer()` | **ERROR** `Support for this compression format has not been built in (11.6003)` |

**A capability probe built on `metadata()` would report HEIC support that does not exist.**

The blocker on an HEVC _encoder_ is licensing before patents: x265 is GPL v2, and linking it into
an artefact distributed under sharp-libvips' Apache-2.0-compatible terms would force GPL on the
whole thing. libde265 (decoder) is LGPL, so the decoder's licence is not the blocker — the patent
pools are.

Either format means self-compiling libvips per target platform, hosting it, setting
`SHARP_FORCE_GLOBAL_LIBVIPS`, and dropping off the prebuilt upgrade path.

_Unresolved:_ whether a server-side HEVC _image_ decoder incurs a pool royalty, and at what rate.
Access Advance publishes no public rate card and none was obtained; no rate is asserted here.

## 9. Passthrough forfeits most of the saving, and refetches every time

Two requests were issued per row, so `origin hits = 2` means nothing was cached:

| upstream mime                   | `isSupported` | resp mime                    | origin B | served B | identical | cache entries | origin hits / 2 reqs |
| ------------------------------- | ------------- | ---------------------------- | -------- | -------- | --------- | ------------- | -------------------- |
| `image/tiff`                    | false         | image/tiff                   | 78,010   | 78,010   | **yes**   | 0             | **2**                |
| `image/bmp`                     | false         | image/bmp                    | 70       | 70       | **yes**   | 0             | **2**                |
| `image/svg+xml`                 | false         | image/svg+xml                | 162      | 162      | **yes**   | 0             | **2**                |
| `image/avif`                    | false         | image/avif                   | 29,433   | 29,433   | **yes**   | 0             | **2**                |
| `image/jpeg` (control)          | true          | image/jpeg                   | 60,059   | 3,890    | no        | 1             | 1                    |
| `image/png` carrying TIFF bytes | true          | **image/png**                | 78,010   | 78,010   | **yes**   | 1             | 1                    |
| no `content-type`               | false         | **application/octet-stream** | 60,059   | 60,059   | **yes**   | 0             | **2**                |

An unsupported mime passes through byte-identical, the upstream `content-type` is relayed with no
validation (BUG-22), no resize and no re-encode happen, and `toCache` is never reached.

What that costs:

| input                           | passthrough | sharp decodes? | -> 200w webp q75 | saved if transcoded |
| ------------------------------- | ----------- | -------------- | ---------------- | ------------------- |
| tiff (uncompressed)             | 78,010      | yes            | 2,744            | 95.0%               |
| tiff (lzw)                      | 579,716     | yes            | 2,726            | 99.3%               |
| avif (q50, effort 4)            | 24,817      | yes            | 2,732            | 84.1%               |
| svg                             | 162         | yes            | 1,096            | **-1069%**          |
| jpeg q80 (supported, for scale) | 60,059      | yes            | 2,730            | 93.5%               |

**Every format the proxy refuses except SVG is one sharp can already decode**, and refusing costs
84–99% of the possible saving. SVG is the opposite — rasterising a 162-byte vector to 1.9 kB is a
regression, so passthrough is correct there and only the caching is wrong.

**Interaction with #10.** The `origin hits = 2 for 2 requests` column _is_ that bug measured.
Every passthrough row refetches from the origin on every request, forever. The two failures
compound: the response the proxy is worst at (78 kB of unresized TIFF, 95% above what it could
serve) is also the one it refetches every time. Fixing #10 alone would stop the refetch but lock
the un-optimised bytes into the cache — `retainedBytesPerEntry` in the committed benchmark
already flags passthrough as the worst offender for the cache budget. The two want fixing
together.

## 10. `Accept` negotiation, for ADR 0004

What browsers actually send for `<img>`, read from engine source rather than folklore:

- **Chromium** (`third_party/blink/common/loader/network_utils.cc`, `ImageAcceptHeader()`):
  `image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8`
- **Firefox** (`netwerk/protocol/http/nsHttpHandler.cpp:215`): `image/avif,` + `image/webp,` +
  `image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5`
- **WebKit/Safari** (`Source/WebCore/loader/cache/CachedResourceRequest.cpp`): `image/webp,` +
  `image/avif,` + `image/heic,image/heic-sequence,` + `image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5`.
  **In Lockdown Mode the whole prefix collapses to just `image/webp,`.**

Three consequences:

1. Every engine puts modern formats **first at q=1** and terminates with `*/*` at q=0.8 or q=0.5.
   Correct negotiation is substring-free: parse the media ranges and honour RFC 9110 §12.5.1
   precedence (`type/subtype` > `type/*` > `*/*`). **Never** `header.includes("image/avif")` —
   the `image/*;q=0.8` tail formally matches AVIF too, at a lower weight.
2. Safari announces `image/heic`, which this build cannot decode (§8), and Lockdown Mode
   announces neither AVIF nor JXL. The fallback path is exercised in the field.
3. **ADR 0004's `Vary: Accept` requirement conflicts with the `immutable` already in
   `cacheControl` (`server.ts:132-133`).** §12.5.5: _"Vary expands the cache key required to match
   a new request to the stored cache entry."_ A response that is both `Vary: Accept` and
   `immutable` is a contradiction a shared cache may resolve badly. _Unresolved:_ CDN-specific
   handling of that pair was not researched, and should be before ADR 0004 is ratified.

Also relevant: 406 is optional. §15.5.7 allows serving a default representation instead, which is
what image CDNs do.

Note the structural limit on the current design: **the passthrough policy is keyed on mime alone,
and mime alone cannot distinguish "still PNG" from "APNG" or "still WebP" from "animated WebP".**
Only the container can — `acTL` before `IDAT` for PNG, `metadata().pages > 1` for WebP/GIF/TIFF.

---

## Explicitly not verified

- Whether real-world GIFs from encoders other than libvips/cgif place the NETSCAPE block where
  §2 assumes. The inference is from the spec, not measured across encoders.
- Whether a server-side HEVC image decoder incurs a pool royalty, and at what rate.
- The dither choice in §5 — RMSE is the wrong metric for banding, and the fixture is
  high-frequency by design.
- CDN behaviour for a response carrying both `Vary: Accept` and `Cache-Control: immutable`.
- MDN vs caniuse disagreement on APNG in Edge (12 vs 79).
- Which sharp/libvips release renamed `gifsave`'s `reoptimise` to `reuse`.
- The lovell/libimagequant fork's own `COPYRIGHT` file; the BSD-2 claim rests on sharp-libvips'
  THIRD-PARTY-NOTICES table.
- Linux-x64 timings. All numbers here are darwin-arm64. Byte counts are portable within the 0.1%
  tolerance `BENCHMARK.md` establishes; **timings are not** and should not be treated as such.

## Reproducing

Measurement scripts were written to a scratch directory outside the repo and are not committed —
they depend on fixtures (a hand-built APNG, a 70 MB GIF, a `sips`-made HEIC) too large or too
platform-specific to carry. Each section above names the transform and options precisely enough
to rebuild the measurement; `apps/cache/benchmark/fixtures.ts` supplies the photo generator, and
`docs/adr/README.md` records where the resulting decisions live.

If these numbers need to gate CI rather than inform a decision, the right home is
`apps/cache/benchmark/proxy.bench.ts` alongside the existing scenarios — see `BENCHMARK.md`
§"Which numbers mean something" for why timings must not gate.
