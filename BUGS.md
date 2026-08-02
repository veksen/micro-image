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

## Bugs found while writing the tests

Four defects not in the original report, numbered from 28 to avoid collision.

| #   | Bug                                                                                                                                                                 | Test                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 28  | ipx emits a bogus `image_<encoded-src>` modifier; ipx has no such modifier and already takes the source from the trailing path segment, so the source is sent twice | `providers/ipx.test.ts`      |
| 29  | ipx appends the source **unencoded**, so a source with `?v=1` leaks its query string into the ipx request                                                           | `providers/ipx.test.ts`      |
| 30  | imgproxy uses `btoa` (standard base64, padded) where imgproxy requires unpadded **base64url**; `=`, `+` and `/` land in the path                                    | `providers/imgproxy.test.ts` |
| 31  | imgproxy URLs carry no signature segment and no `/insecure/` prefix, so no imgproxy deployment will accept them                                                     | `providers/imgproxy.test.ts` |

## Coverage

| #   | Bug                                                                 | Test file                                                   | Ledger                                                             |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| 1   | `useImage` downloads a full-size variant and discards the bytes     | `image.component.test.tsx`                                  | yes                                                                |
| 2   | blur radius flattened to a boolean end-to-end                       | `providers/micro-image.test.ts`, `image.component.test.tsx` | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 3   | `quality` accepted by the client, ignored by the proxy              | `server.test.ts`                                            | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 4   | `format` accepted by the client, ignored by the proxy               | `server.test.ts`                                            | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 5   | `generateUrl` always emits `blur=false`                             | `providers/micro-image.test.ts`                             | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 6   | imgproxy single-element option arrays are correct by accident       | `providers/imgproxy.test.ts`                                | yes                                                                |
| 7   | duplicate `if (!imageRef.current) return;`                          | —                                                           | no (see below)                                                     |
| 8   | `useImage` cleanup calls `removeEventListener` on property handlers | `use-image.hook.test.tsx`                                   | yes                                                                |
| 9   | `loaded` / `fetching` returned but never gate rendering             | `image.component.test.tsx`                                  | yes                                                                |
| 10  | first paint ships no `srcset` / `sizes` for the preload scanner     | `image.component.test.tsx`                                  | yes                                                                |
| 11  | `getImageProportions` downloads the full original for two integers  | `image-utils.test.ts`                                       | yes                                                                |
| 12  | `Compare` clobbers `onload` and never cleans up                     | `compare.component.test.tsx`                                | yes                                                                |
| 13  | `/api/meta` mishandles a missing `content-length` (see correction)  | `__tests__/api-meta.test.ts`                                | yes                                                                |
| 14  | `/api/meta` never responds to non-GET                               | `__tests__/api-meta.test.ts`                                | yes                                                                |
| 15  | `Cache-Control` missing on every cache hit                          | `server.test.ts`                                            | **fixed** ([#10](https://github.com/veksen/micro-image/issues/10)) |
| 16  | unbounded in-memory cache                                           | `cache.test.ts`                                             | **fixed** ([#6](https://github.com/veksen/micro-image/issues/6))   |
| 17  | cache key omits quality / format / blur radius (see correction)     | `server.test.ts`, `cache.test.ts`                           | **fixed** ([#8](https://github.com/veksen/micro-image/issues/8))   |
| 18  | `isAnimatedGif` runs unguarded on every mime (see correction)       | `is-animated-gif.test.ts`, `server.test.ts`                 | **fixed** ([#4](https://github.com/veksen/micro-image/issues/4))   |
| 19  | `Buffer.from(data, "binary")` double-buffers                        | `server.test.ts` (fidelity only)                            | no — cost is perf, belongs in the benchmark                        |
| 20  | `isAnimatedGif` copies the buffer byte-by-byte in JS                | —                                                           | **fixed** incidentally with 18                                     |
| 21  | unsupported content types are never cached                          | `server.test.ts`                                            | **fixed** ([#10](https://github.com/veksen/micro-image/issues/10)) |
| 22  | upstream `content-type` echoed with no validation                   | `server.test.ts`                                            | **fixed** ([#10](https://github.com/veksen/micro-image/issues/10)) |
| 23  | no thundering-herd protection                                       | `server.test.ts`                                            | **fixed** ([#18](https://github.com/veksen/micro-image/issues/18)) |
| 24  | no `timeout` / `maxContentLength` / `maxBodyLength` on axios        | `server.test.ts`                                            | yes                                                                |
| 25  | SSRF — `?image=` accepts any URL                                    | `server.test.ts`                                            | yes                                                                |
| 26  | sharp errors bubble up as unhandled 500s                            | `server.test.ts`                                            | yes                                                                |
| 27  | quality / format / blur advertised but silently dropped             | covered by 2, 3, 4                                          | **fixed** ([#9](https://github.com/veksen/micro-image/issues/9))   |
| 28  | ipx bogus `image_` modifier                                         | `providers/ipx.test.ts`                                     | yes                                                                |
| 29  | ipx unencoded source URL                                            | `providers/ipx.test.ts`                                     | yes                                                                |
| 30  | imgproxy standard base64 instead of base64url                       | `providers/imgproxy.test.ts`                                | yes                                                                |
| 31  | imgproxy missing signature / `insecure` segment                     | `providers/imgproxy.test.ts`                                | yes                                                                |

### Deliberately untested

- **BUG-7** (duplicate guard) has no observable behaviour. A test would assert
  nothing. It is a lint-level cleanup.
- **BUG-19** and **BUG-20** are wasted work, not wrong answers. `server.test.ts`
  proves the bytes are not corrupted; the cost is a benchmark measurement, not
  an assertion.

## Layout

Tests sit next to the code they cover, as `*.test.ts` / `*.test.tsx`.

```
apps/cache/src/            cache.test.ts, is-animated-gif.test.ts, server.test.ts
                           test-helpers.ts      fixture images + a real local origin
apps/docs/src/             image-utils.test.ts, components/compare.component.test.tsx
                           __tests__/api-meta.test.ts
packages/micro-image-image/src/  providers/*.test.ts, use-image.hook.test.tsx,
                                 image.component.test.tsx, image-cache-provider.test.tsx
```

`apps/docs/src/__tests__/api-meta.test.ts` lives outside `pages/` on purpose —
Next.js turns every file under `pages/` into a route, so a test file there would
ship as `/api/meta.test`.

### Fixtures

No binary fixtures are committed. `apps/cache/src/test-helpers.ts` generates
images with sharp at runtime, so fixtures can never drift from the installed
sharp version, and hand-builds GIF containers byte by byte — the only way to
control exactly what `isAnimatedGif` parses.

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
