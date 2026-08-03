# Known bugs and how the test suite tracks them

The suite is green today **on purpose**. `micro-image` has a backlog of known
defects, and CI should not go red until they are actually being worked on. Each
bug is pinned by two tests instead of one.

## The convention

**Characterization test** — asserts what the code does _today_, tagged with the
bug number. It keeps CI green and acts as a regression net while refactoring.

```ts
it("emits blur=false on every url that does not ask for blur [BUG-5]", () => {
  expect(generateUrl({ url: URL_BASE, src: SRC })).toBe(`${URL_BASE}?image=...&blur=false`);
});
```

**Ledger test** — asserts the behaviour we _want_, written with `it.fails`.
Vitest inverts it: it passes while the assertion fails, and **fails the moment
the assertion starts passing**.

```ts
it.fails("BUG-5: blur should be absent from the url when not requested", () => {
  expect(generateUrl({ url: URL_BASE, src: SRC })).not.toContain("blur");
});
```

So the day someone fixes BUG-5, CI goes red on the ledger test and tells them
exactly what to do next.

### Fixing a bug

1. Fix the code.
2. CI fails on the `it.fails` ledger test for that bug.
3. Change `it.fails` to `it`.
4. Delete the matching characterization test — it now documents a lie.
5. Update the row in the table below.

Never delete a ledger test to make CI pass.

## Corrections to the original report

Three entries did not survive contact with a test. The suite follows what was
measured, not what was reported.

**BUG-17 is not in `cache.ts`.** `buildId` iterates `Object.entries(options)`
and will include any key it is handed — passing `quality` produces
`...__quality-30`. The defect is the _call site_ in `server.ts`, which only ever
passes `width` and `blur`. The ledger entry lives in `server.test.ts`.

> **Fixed** — see [#8](https://github.com/veksen/micro-image/issues/8). The query
> string is now parsed once by `parseCacheOptions`, and that one object is handed
> to both the cache key and the transform, so the two can no longer disagree
> about what was requested. `buildId` sorts its keys, so a caller cannot cause a
> miss by reordering a literal, and drops `undefined`, so an unusable option and
> an absent one share an id. `?width=`, `?width=abc`, `?width=0` and `?width=-5`
> all normalise to "no width" instead of minting `width-0`, `width-NaN` and a
> negative that reached sharp.
>
> This changes the key format, so a deployed instance sees a one-time cold cache.
> Note the follow-up in [#9](https://github.com/veksen/micro-image/issues/9): the
> key now carries quality, format and blur radius, but the transform still
> ignores them, so those requests over-partition the cache without changing
> bytes. That is wasteful and safe, which is the right way round.

**BUG-13 does not produce `NaN` on a missing header.** `Headers.get` returns
`null` when the header is absent, and `Number(null)` is `0`, not `NaN`. The real
symptom is worse: `Compare` renders `props.contentLength ? … : "loading..."`, and
`0` is falsy, so the panel sits on "loading…" forever. `NaN` appears only when
the header is present but non-numeric.

**BUG-18 is far more severe than "theoretically possible".** The report said
non-GIF input "happens to fall through to `delayTime = 0`". It does not. Byte 10
of a JPEG — where this function expects the GIF logical screen descriptor — is
the first quantization-table entry, whose value is set by encoder quality. The
guard uses bitwise AND (`introducer & 0x21 && label & 0xf9`) rather than
equality, so it passes on any byte pair sharing a single bit. Measured on
identical 64×64 gradient JPEGs:

| quality | byte 10 | introducer | label  | detected as animated GIF |
| ------- | ------- | ---------- | ------ | ------------------------ |
| 50      | `0x0e`  | `0x10`     | `0x0e` | no                       |
| 60      | `0x0b`  | `0x0d`     | `0x0b` | **yes** (delay 3598)     |
| 70      | `0x08`  | `0x0a`     | `0x08` | no                       |
| 75      | `0x07`  | `0x08`     | `0x07` | no                       |
| 80      | `0x06`  | `0x06`     | `0x06` | no                       |
| 85      | `0x04`  | `0x05`     | `0x04` | no                       |
| 90      | `0x03`  | `0x03`     | `0x03` | **yes** (delay 1027)     |
| 95      | `0x01`  | `0x02`     | `0x01` | no                       |
| 100     | `0x01`  | `0x01`     | `0x01` | **yes** (delay 257)      |

A false positive makes the route return the **original bytes, uncompressed and
unresized**, and cache them under a key claiming the requested width. Roughly
a third to a half of real-world JPEG qualities land in the bad band, which
defeats the entire purpose of the proxy for those images. It is broad enough to
mask corrupt payloads too: `"not an image at all"` is served back with a 200.

This is the highest-impact item in the backlog and is not currently ranked as
such.

> **Fixed** — see [#4](https://github.com/veksen/micro-image/issues/4). The probe
> now runs only on `image/gif`, matches the extension bytes by equality, decodes
> the delay little-endian, and bounds-checks its reads. BUG-20 went with it: the
> byte-by-byte copy is gone, the parse reads the `Buffer` in place.
>
> The BUG-18b ledger test had to be **rewritten rather than flipped**. As written
> it built its own `DataView` over the fixture and asserted
> `dv.getUint16(gceOffset + 4) === 10` — an assertion about `DataView`'s default
> endianness, which never called the module under test and so could never have
> flipped. Endianness is not observable through a boolean (a delay is non-zero
> either way round), so `gifDelayTime` is now exported and asserted directly.

> **Superseded** — see [#52](https://github.com/veksen/micro-image/issues/52).
> Fixing the false positive left the false negative behind: the same probe
> reported **every looping GIF** as a still image, because it required
> `0x21 0xF9` at `6 + 7 + globalColorTableSize` and that is exactly where a
> looping GIF puts its NETSCAPE 2.0 Application Extension (`0x21 0xFF`). The
> first real Graphics Control Extension sits 19 bytes later. Measured end to end
> at `?width=400`: 30 frames in, 1 frame out. Animated WebP was worse — the guard
> read `upstreamContentType === gifMime`, so WebP never reached it at all.
>
> The suite could not see either one. Its only animated fixture was a hand-built
> container with no Application Extension, so the probe looked correct against
> the only GIF it was ever asked about.
>
> `is-animated-gif.ts` is gone. `is-animated.ts` asks the decoder instead:
> `metadata().pages`, populated on a default load, no full decode, and it covers
> GIF, WebP and TIFF alike. There is no offset left to read and therefore no
> byte order left to get wrong, so **BUG-18b has no direct successor**. What
> carried over is its reason for existing — a boolean cannot distinguish a
> correct count from a wrong one — so `frameCount` is exported and asserted
> against fixtures whose frame count is known by construction. The BUG-18
> quality sweep carried over unchanged; a new test plants the exact byte pair the
> retired probe looked for, at the exact offset, and asserts the JPEG is still
> not animated.
>
> `test-helpers.ts` grew `makeLoopingGif`, a GIF encoded here rather than by
> sharp — LZW, NETSCAPE extension and all. Every other GIF in the suite comes
> from libvips, which is the library being asked about animation, so their
> agreeing proved nothing about a GIF from anywhere else.

## Bugs found while writing the tests

Five defects not in the original report, numbered from 28 to avoid collision.

| #   | Bug                                                                                                                                                                 | Test                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 28  | ipx emits a bogus `image_<encoded-src>` modifier; ipx has no such modifier and already takes the source from the trailing path segment, so the source is sent twice | `providers/ipx.test.ts`      |
| 29  | ipx appends the source **unencoded**, so a source with `?v=1` leaks its query string into the ipx request                                                           | `providers/ipx.test.ts`      |
| 30  | imgproxy uses `btoa` (standard base64, padded) where imgproxy requires unpadded **base64url**; `=`, `+` and `/` land in the path                                    | `providers/imgproxy.test.ts` |
| 31  | imgproxy URLs carry no signature segment and no `/insecure/` prefix, so no imgproxy deployment will accept them                                                     | `providers/imgproxy.test.ts` |
| 32  | imgproxy refuses a source carrying a raw non-ASCII or control character, so the provider has to percent-encode those before the base64                              | `providers/imgproxy.test.ts` |

> **BUG-30, BUG-31 and BUG-32 fixed with BUG-6** — see
> [#11](https://github.com/veksen/micro-image/issues/11). The source is now
> unpadded base64url, the signature position always carries `insecure`, and each
> processing option is built from its own arguments so a missing one cannot emit
> `undefined`.
>
> BUG-32 was found while verifying the other three, and only shows up against a
> running instance: imgproxy decodes the base64 and hands the source straight to
> its HTTP client, which refuses anything outside printable ASCII with
> `Source is unreachable` before it fetches. Printable ASCII is left raw, which
> was measured rather than assumed — a stock instance accepts space, `<`, `>`,
> `|` and the rest, and escaping `%` would double-escape an already-escaped
> source.
>
> Verified against a stock `darthsim/imgproxy` container and the deployed
> instance the docs showcase points at: every URL shape the `<Image>` component
> generates returns 200 with an image at the requested width, and the URL shape
> this replaced returns 403.

## Bugs found by a research issue

| #   | Bug                                                                                                                                                                                                              | Test                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 35  | every consumer ships every provider: `getGeneralUrlFunction` selects with a `switch` over a runtime string, which no bundler can shake, so a micro-image-only consumer carries the ipx and imgproxy URL builders | `tree-shaking.test.ts` |

Costs a one-provider consumer 598–825 B minified, 178–290 B gzip, and grows by 300–410 B
minified per provider added. Run `npm run size -w @micro-image/image` to reproduce those
numbers. It nearly doubled when #11 and #12 made the imgproxy and ipx URLs correct, without a
provider being added. The ledger test asserts rolldown's module graph rather than a byte budget,
so it fails
the day the fix lands and not before, and it reads the provider list off disk so a newly added
provider is covered without editing it. The fix is a breaking change to a published API and is
gated on [ADR 0011](docs/adr/0011-provider-selection.md), which is still `proposed` — see
[#40](https://github.com/veksen/micro-image/issues/40).

## Coverage

| #   | Bug                                                                 | Test file                                                   | Ledger                                                             |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `useImage` downloads a full-size variant and discards the bytes     | `image.component.test.tsx`                                  | yes                                                                |
| 2   | blur radius flattened to a boolean end-to-end                       | `providers/micro-image.test.ts`, `image.component.test.tsx` | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 3   | `quality` accepted by the client, ignored by the proxy              | `server.test.ts`                                            | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 4   | `format` accepted by the client, ignored by the proxy               | `server.test.ts`                                            | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 5   | `generateUrl` always emits `blur=false`                             | `providers/micro-image.test.ts`                             | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 6   | imgproxy single-element option arrays are correct by accident       | `providers/imgproxy.test.ts`                                | **fixed** ([#11](https://github.com/veksen/micro-image/issues/11)) |
| 7   | duplicate `if (!imageRef.current) return;`                          | —                                                           | **fixed** ([#15](https://github.com/veksen/micro-image/issues/15)) |
| 8   | `useImage` cleanup calls `removeEventListener` on property handlers | `use-image.hook.test.tsx`                                   | yes                                                                |
| 9   | `loaded` / `fetching` returned but never gate rendering             | `image.component.test.tsx`                                  | yes                                                                |
| 10  | first paint ships no `srcset` / `sizes` for the preload scanner     | `image.component.test.tsx`                                  | **fixed** ([#17](https://github.com/veksen/micro-image/issues/17)) |
| 11  | `getImageProportions` downloads the full original for two integers  | `image-utils.test.ts`                                       | yes                                                                |
| 12  | `Compare` clobbers `onload` and never cleans up                     | `compare.component.test.tsx`                                | yes                                                                |
| 13  | `/api/meta` mishandles a missing `content-length` (see correction)  | `__tests__/api-meta.test.ts`                                | yes                                                                |
| 14  | `/api/meta` never responds to non-GET                               | `__tests__/api-meta.test.ts`                                | yes                                                                |
| 15  | `Cache-Control` missing on every cache hit                          | `server.test.ts`                                            | **fixed** ([#10](https://github.com/veksen/micro-image/issues/10)) |
| 16  | unbounded in-memory cache                                           | `cache.test.ts`                                             | **fixed** ([#6](https://github.com/veksen/micro-image/issues/6))   |
| 17  | cache key omits quality / format / blur radius (see correction)     | `server.test.ts`, `cache.test.ts`                           | **fixed** ([#8](https://github.com/veksen/micro-image/issues/8))   |
| 18  | `isAnimatedGif` runs unguarded on every mime (see correction)       | `is-animated.test.ts`, `server.test.ts`                     | **fixed** ([#4](https://github.com/veksen/micro-image/issues/4))   |
| 19  | `Buffer.from(data, "binary")` double-buffers                        | `server.test.ts` (fidelity only)                            | **fixed** ([#15](https://github.com/veksen/micro-image/issues/15)) |
| 20  | `isAnimatedGif` copies the buffer byte-by-byte in JS                | —                                                           | **fixed** incidentally with 18                                     |
| 21  | unsupported content types are never cached                          | `server.test.ts`                                            | **fixed** ([#10](https://github.com/veksen/micro-image/issues/10)) |
| 22  | upstream `content-type` echoed with no validation                   | `server.test.ts`                                            | **fixed** ([#10](https://github.com/veksen/micro-image/issues/10)) |
| 23  | no thundering-herd protection                                       | `server.test.ts`                                            | **fixed** ([#18](https://github.com/veksen/micro-image/issues/18)) |
| 24  | no `timeout` / `maxContentLength` / `maxBodyLength` on axios        | `server.test.ts`                                            | **fixed** ([#7](https://github.com/veksen/micro-image/issues/7))   |
| 25  | SSRF — `?image=` accepts any URL                                    | `server.test.ts`                                            | yes                                                                |
| 26  | sharp errors bubble up as unhandled 500s                            | `server.test.ts`                                            | **fixed** ([#7](https://github.com/veksen/micro-image/issues/7))   |
| 27  | quality / format / blur advertised but silently dropped             | covered by 2, 3, 4                                          | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 28  | ipx bogus `image_` modifier                                         | `providers/ipx.test.ts`                                     | **fixed** ([#12](https://github.com/veksen/micro-image/issues/12)) |
| 29  | ipx unencoded source URL                                            | `providers/ipx.test.ts`                                     | **fixed** ([#12](https://github.com/veksen/micro-image/issues/12)) |
| 30  | imgproxy standard base64 instead of base64url                       | `providers/imgproxy.test.ts`                                | **fixed** ([#11](https://github.com/veksen/micro-image/issues/11)) |
| 31  | imgproxy missing signature / `insecure` segment                     | `providers/imgproxy.test.ts`                                | **fixed** ([#11](https://github.com/veksen/micro-image/issues/11)) |
| 32  | imgproxy source not escaped outside printable ASCII                 | `providers/imgproxy.test.ts`                                | **fixed** ([#11](https://github.com/veksen/micro-image/issues/11)) |
| 33  | every looping gif is flattened to one frame (see correction)        | `is-animated.test.ts`, `server.test.ts`                     | **fixed** ([#52](https://github.com/veksen/micro-image/issues/52)) |
| 34  | animated webp has no guard at all, so it is flattened too           | `is-animated.test.ts`, `server.test.ts`                     | **fixed** ([#52](https://github.com/veksen/micro-image/issues/52)) |
| 35  | every consumer ships every provider                                 | `tree-shaking.test.ts`                                      | yes                                                                |
| 36  | apng is flattened to one frame, 97.9% of the bytes discarded        | `is-animated.test.ts`, `server.test.ts`                     | **fixed** ([#53](https://github.com/veksen/micro-image/issues/53)) |

### Deliberately untested

- **BUG-7** (duplicate guard) has no observable behaviour. A test would assert
  nothing. It is a lint-level cleanup.
- **BUG-19** and **BUG-20** are wasted work, not wrong answers. `server.test.ts`
  proves the bytes are not corrupted; the cost is a benchmark measurement, not
  an assertion. The benchmark that measured BUG-20 is gone with the function it
  measured — see `BENCHMARK.md` § Micro-benchmark findings, where the figures are
  kept as history and `is-animated.bench.ts` measures the replacement.

## Layout

Tests sit next to the code they cover, as `*.test.ts` / `*.test.tsx`.

```
apps/cache/src/            cache.test.ts, is-animated.test.ts, server.test.ts
                           test-helpers.ts      fixture images + a real local origin
apps/docs/src/             image-utils.test.ts, components/compare.component.test.tsx
                           __tests__/api-meta.test.ts
packages/micro-image-image/src/  providers/*.test.ts, use-image.hook.test.tsx,
                                 image.component.test.tsx, image-cache-provider.test.tsx
                                 tree-shaking.test.ts   the entry graph, not one module
```

`apps/docs/src/__tests__/api-meta.test.ts` lives outside `pages/` on purpose —
Next.js turns every file under `pages/` into a route, so a test file there would
ship as `/api/meta.test`.

### Fixtures

No binary fixtures are committed. `apps/cache/src/test-helpers.ts` generates
images with sharp at runtime, so fixtures can never drift from the installed
sharp version.

It also hand-builds one, and that is deliberate. `makeLoopingGif` encodes a real
animated GIF here — LZW stream, NETSCAPE 2.0 Application Extension, one Graphics
Control Extension per frame. Every other GIF in the suite comes out of libvips,
which is the same library the animation probe asks about animation, so the two
agreeing proves nothing about a GIF written by anything else. That blind spot is
[#52](https://github.com/veksen/micro-image/issues/52): the suite's only animated
fixture happened to have no Application Extension, and the probe looked correct
against it while flattening every real looping GIF it was given.

Proxy tests run against a **real local HTTP origin** rather than a mocked axios,
so the actual network path (agents, headers, arraybuffer decoding) stays under
test. The origin counts hits per path, which is how the cache, thundering-herd
and cache-key tests make their assertions.

### The one source change

`apps/cache/src/index.ts` called `fastify.listen()` at import time, so the route
could not be imported by a test. Server construction moved to
`apps/cache/src/server.ts` as `buildServer()`, and `index.ts` now only listens.
Behaviour is unchanged — every bug above is preserved exactly.

## Running

```sh
npm run test           # everything, via turbo
npm run test -w apps/cache
npm run test:watch -w packages/micro-image-image
```
