---
status: blocked
---

# The srcset ladder is undecided pending measurement

**Blocked, not proposed.** Open question 2 from `VISION.md`. An earlier revision of this file
proposed a fixed ladder of `[320, 480, 640, 800, 1024, 1280, 1600, 1920, 2400]` clamped to
intrinsic width. That proposal is withdrawn: three of the four claims it rested on did not
survive being checked. It is recorded below so the same reasoning is not repeated.

## Context

Every path that produces `ImageMeta` decides which widths go in `srcset`. Today
`generateSrcSet` in `packages/micro-image-image/src/image.component.tsx` emits
`Array.from({ length: 20 }).slice(1).map(i => i * 100)` — 19 entries from 100w to 1900w, the
same for every image, with no clamp to intrinsic width.

## Why the earlier proposal was withdrawn

- **The framing was a false choice.** It presented "fixed ladder vs derived per image". The
  code is already a fixed ladder, so that was never the decision facing this repo. The real
  variable is spacing, which the ADR never named.
- **"Cache hit rate is materially better" was never measured.** Both candidates were fixed
  ladders emitting the same set for every image, and the browser downloads exactly one
  candidate, so the proxy only ever generates the widths actually requested. Entries are
  created lazily either way.
- **The cost model was wrong.** The proposal was defended with pixel-area arithmetic. Bytes do
  not track pixel area.
- **It also misread the code**, describing 20 entries reaching 2000w.

## What has been measured

One sweep, on the benchmark's photo-like fixture, JPEG q75, resized from a 3000×2000 source:

| width | 320 | 400 | 480  | 640  | 800  | 1024 | 1280 | 1600 | 1920 | 2400  |
| ----- | --- | --- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ----- |
| KB    | 6.7 | 8.7 | 10.6 | 15.7 | 20.3 | 30.4 | 45.3 | 67.2 | 95.6 | 167.0 |

Bytes scale as **width^1.6**, i.e. pixel-area^0.8 — sub-linear in area. So one rung of
overshoot costs less than the area arithmetic suggests, but the absolute cost is strongly
asymmetric:

- `need 320, get 400` → 1.30× bytes, **+2 KB**
- `need 800, get 1024` → 1.50× bytes, **+10 KB**
- `need 1920, get 2400` → 1.75× bytes, **+71 KB**

That asymmetry is the finding. A constant-ratio ladder spaces the cheap end and the expensive
end identically, which is the wrong shape: the kilobytes are all at the top. It also means the
current ladder's worst ratio steps (100→200 is 2×) cost about 1 KB and are close to
irrelevant, while its 1900w ceiling and its missing clamp are not.

**Do not treat this table as the answer.** It is one synthetic fixture, one codec, one quality.
A first attempt at the same measurement using gaussian noise produced exponent ~3.0 — bytes
falling _faster_ than area, the opposite conclusion — because noise is incompressible and
downscaling averages it away. `apps/cache/benchmark/fixtures.ts` documents that trap in its
own docstring. The exponent is a property of the content, not of the ladder.

## What is still unmeasured

Ratifying this ADR needs both halves, and only the first is a benchmark:

1. **The cost curve**, across real photographs as well as synthetic fixtures, across
   JPEG/WebP/AVIF (a better codec changes the exponent), and across flat content such as
   screenshots and illustrations, which behave differently again.
2. **The demand distribution** — which widths are actually requested. No benchmark can supply
   this; it comes from real traffic or from an assumption stated out loud. The withdrawn
   proposal silently assumed container widths uniform over 200–2000px, which is what made its
   averages meaningless.

## The parts that do not depend on this decision

Three defects in the current implementation are true under any ladder, and should be fixed
without waiting for ratification:

- **No clamp to intrinsic width.** A 900px source advertises up to 1900w, so the browser can
  request an upscale and the proxy will generate and cache it. Clamping needs the intrinsic
  width, which arrives with the `?meta` endpoint (roadmap step 3).
- **The ceiling is 1900w.** A 2× display with a 1200px container needs 2400 and is offered
  nothing.
- **The component should not own the ladder at all.** `srcset` is a field on `ImageMeta`; the
  contract says every path produces it and the component consumes it. A component that
  manufactures its own ladder contradicts `.claude/skills/image-meta-contract/`. The ladder
  belongs where the intrinsic width is known — the shared core and the proxy.

That last point is the one worth acting on first. It is a simplification rather than a
decision, and it makes this ADR smaller: once the component consumes `srcset`, the ladder
becomes a core concern with one place to change it.

## Progress

Blocked on the measurement in "What is still unmeasured". The cost half is an extension of the
existing benchmark: `apps/cache/benchmark/proxy.bench.ts` already records `servedBytes`,
`retainedBytesPerEntry`, and calibrated `coldMs`/`coldCpuMs` per scenario, and appends to
`history.jsonl`. Running the existing scenarios across a range of widths rather than a single
400w produces the curve directly, in the format the project already trusts.
