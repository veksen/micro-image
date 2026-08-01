# Benchmarks

Two benchmarks, measuring different things.

**End-to-end proxy** (`apps/cache/benchmark/proxy.bench.ts`) runs the real
Fastify route against a real local HTTP origin with real sharp compression, and
reports bytes saved and time taken per scenario. This is the one that tracks
whether the product does what it claims.

**Micro-benchmarks** (`*.bench.ts`, via `vitest bench`) cover hot pure
functions: the GIF container parse, cache-key construction and lookup, and
client-side URL generation.

```sh
npm run benchmark -w apps/cache                  # end-to-end, compares against baseline
npm run benchmark -w apps/cache -- --save-baseline
npm run bench -w apps/cache                      # micro
npm run bench -w packages/micro-image-image      # micro

BENCH_ITERATIONS=50 npm run benchmark -w apps/cache
```

## Which numbers mean something

Not every number here is evidence. They fall into three groups, and the pipeline
treats each differently.

| Kind               | Example                                                      | Reproducible     | Gates CI                   |
| ------------------ | ------------------------------------------------------------ | ---------------- | -------------------------- |
| Behavioural counts | upstream fetches per request, Cache-Control present on a hit | yes, exactly     | yes, in the **test suite** |
| Byte counts        | origin kB, served kB, saved %                                | yes, within 0.1% | no, not yet                |
| Timings            | cold ms, warm ms, hz                                         | no               | never                      |

Behavioural facts are assertions, not measurements, so they live in
`server.test.ts` where they actually fail the build. The benchmark reports them
too, but only to give the byte numbers context.

### Cross-platform reproducibility

Measured directly rather than assumed. Same generator, same sharp 0.33.2 and
libvips 8.15.1, on darwin-arm64 against linux-x64 in Docker:

|                           | darwin-arm64       | linux-x64          |
| ------------------------- | ------------------ | ------------------ |
| raw pixel sha256          | `24cc8994aba741e3` | `24cc8994aba741e3` |
| jpeg q60 origin / served  | 65252 / 8273       | 65252 / 8273       |
| jpeg q80 origin / served  | 212829 / 8205      | 212829 / 8205      |
| jpeg q100 origin / served | 1450007 / 8135     | 1450007 / 8135     |
| png origin / served       | 1256689 / 321220   | 1256687 / 321225   |

JPEG through mozjpeg is byte-identical across platforms. PNG differs by 2-5
bytes out of ~1.2 MB, from a different zlib build. So a committed baseline is
portable, but comparison needs a tolerance rather than exact equality. That is
why `BYTE_TOLERANCE` is 0.1%.

## The baseline

`apps/cache/benchmark/baseline.json` is committed and records the numbers
**before any of the bugs in `BUGS.md` were fixed**. Every run compares against
it and prints a `Δ served` column, so the effect of a fix is visible immediately.

It is updated by hand with `--save-baseline`, never automatically by CI.
Auto-committing it would put a merge conflict on every PR and quietly overwrite
the "before" numbers that make the case for the fixes.

`results.json` is the scratch output of a normal run. It is gitignored.

## Performance over time

`apps/cache/benchmark/history.jsonl` is an append-only record, one JSON object
per line, committed to the repo. CI appends a point on every push to `main` and
commits it back. Pull requests measure and report but record nothing, so the
history follows `main` and stays linear.

```sh
npm run benchmark:history -w apps/cache              # terminal trend
npm run benchmark:history -w apps/cache -- --html    # standalone HTML report
npm run benchmark:history -w apps/cache -- --limit 40
npm run benchmark -w apps/cache -- --append-history  # record a point by hand
```

```
served bytes
scenario                 trend         now   vs first
-----------------------------------------------------
jpeg q80 -> 400w         ▁▁▁▁▁      8.0 kB          =
jpeg q100 -> 400w        ███▁▁      7.9 kB     -99.4%
jpeg q60 -> 400w         ███▁▁      8.1 kB     -87.3%

behavioural counts
returned unprocessed     ███▁▁           1      3 → 1
```

The commit that records a point uses `[skip ci]`. That is load-bearing: without
it the push retriggers the workflow, which appends another point, which pushes
again.

### Calibrated timings

Raw wall-clock cannot be compared across CI runs. GitHub rotates runner
hardware and neighbours vary, so a chart of `cold ms` over months mostly plots
the runner lottery.

Every run therefore times a fixed calibration workload — a known decode, resize
and encode straight through sharp, plus a fixed pure-JS loop — and records each
scenario timing as a ratio against it. `0.93` means "this scenario took 0.93 of
one reference resize", which is comparable across machines and across months.
The trend charts the ratios; raw ms are kept in the record for reference.

Two rules keep this readable, both stated in `calibration.ts`:

1. The calibration workload must never change. Editing it silently rebases
   every ratio ever recorded. If it truly has to change, bump
   `CALIBRATION_VERSION`.
2. It must not call any of our own code. It measures the machine, not the proxy,
   so it goes straight to sharp.

The trend report prints the calibration spread across the window it is showing,
so a run on unusually slow hardware is visible rather than mistaken for a
regression.

## Where results are held

|                 | What                                 | Lifetime                     |
| --------------- | ------------------------------------ | ---------------------------- |
| `history.jsonl` | one point per main commit, committed | permanent, append-only       |
| `baseline.json` | pre-fix reference, committed         | until deliberately refreshed |
| `history.html`  | generated report, gitignored         | regenerated on demand        |
| `results.json`  | last local run, gitignored           | overwritten every run        |
| job summary     | markdown table on the PR             | with the workflow run        |
| artifact        | results and history from CI          | GitHub's artifact retention  |

`baseline.json` answers "what did this specific change do". `history.jsonl`
answers "how has this moved over time". The baseline is a fixed pre-fix
reference refreshed only deliberately; the history accumulates on its own and is
never rewritten.

## What CI does

The `Benchmark` workflow runs on every PR. It fails **only if the benchmark
cannot run** — a crash, a type error, a broken import. It never fails on the
numbers, for two reasons: wall-clock timings on a shared runner are not a
signal, and the byte counts today describe behaviour we already know is broken
and have not fixed yet. Gating on them would lock the bugs in.

Once the backlog is fixed and the numbers stabilise, the natural next step is to
gate on `Δ served` against the refreshed baseline, at the 0.1% tolerance the
Docker comparison justifies. A stricter option, if timings ever need to gate, is
to run the benchmark on the merge base and the PR head in the same job and
compare the two, which cancels out runner variance. Neither is worth it while
the headline numbers are dominated by a single unfixed bug.

## Baseline reading, and what fixes should do to it

Captured on darwin-arm64, node v24.18.0, 15 iterations.

| scenario             | origin kB | served kB | saved % | cold ms | warm ms |
| -------------------- | --------- | --------- | ------- | ------- | ------- |
| jpeg q80 -> 400w     | 207.8     | 8.0       | 96.1%   | 13.55   | 0.27    |
| jpeg q100 -> 400w    | 1416.0    | 1416.0    | 0.0%    | 18.86   | 15.26   |
| jpeg q60 -> 400w     | 63.7      | 63.7      | 0.0%    | 1.76    | 0.89    |
| jpeg q80 -> blur     | 207.8     | 5.9       | 97.2%   | 14.88   | 0.20    |
| png 800x600 -> 400w  | 1227.2    | 313.7     | 74.4%   | 18.54   | 3.44    |
| webp 800x600 -> 400w | 63.6      | 8.0       | 87.4%   | 14.43   | 0.23    |
| animated gif         | 0.1       | 0.1       | 0.0%    | 0.22    | 0.04    |
| svg (unsupported)    | 0.1       | 0.1       | 0.0%    | 0.22    | 0.24    |

Working correctly: q80 jpeg saves 96%, webp 87%, png 74%. Where the proxy runs,
it does its job.

The two 0.0% jpeg rows are BUG-18. A 1.4 MB image is served **whole** to a
client that asked for 400px.

### Verified: fixing BUG-18 moves the benchmark

Rather than assume, the mime guard was applied temporarily and the benchmark
re-run against the baseline. The patch was reverted afterwards; the bug is still
open.

| scenario          | served before | served after | Δ served   | cold before | cold after | warm before | warm after |
| ----------------- | ------------- | ------------ | ---------- | ----------- | ---------- | ----------- | ---------- |
| jpeg q100 -> 400w | 1416.0 kB     | 7.9 kB       | **-99.4%** | 18.86 ms    | 24.16 ms   | 15.26 ms    | 0.23 ms    |
| jpeg q60 -> 400w  | 63.7 kB       | 8.1 kB       | **-87.3%** | 1.76 ms     | 11.85 ms   | 0.89 ms     | 0.19 ms    |

Every unaffected scenario reported `=`, so the comparison does not invent
movement.

One result is worth being precise about: **cold latency gets worse.** It rises
28% for q100 and 573% for q60, because the proxy now actually decodes, resizes
and re-encodes instead of short-circuiting out of the work. The server was only
"fast" on those rows because it was doing nothing.

The wins are elsewhere and much larger. Bytes over the wire drop 99.4%, and warm
latency drops from 15.26 ms to 0.23 ms — about 66x — because a cache hit now
serves 8 kB instead of 1.4 MB. Trading 5 ms of server CPU for 1.4 MB of client
bandwidth is the trade this product exists to make.

So: yes, the fixes should improve the benchmark, but "improve" is not one
number. Read `Δ served` first.

### What each fix should move

| Fix                                      | Expected movement                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| BUG-18 gif false positive                | `Δ served` -99.4% on q100, -87.3% on q60; warm latency ~66x better; cold latency worse |
| BUG-20 byte-by-byte buffer copy          | cold latency; the copy is ~7,600x slower than reading in place at 512 kB               |
| BUG-19 redundant Buffer copy             | cold latency, less GC pressure                                                         |
| BUG-21 unsupported mimes never cached    | svg upstream fetches per request, 1.00 toward 0                                        |
| BUG-23 no request coalescing             | herd upstream fetches, 8 toward 1                                                      |
| BUG-3 / BUG-4 quality and format ignored | unlocks webp output, a savings axis the benchmark cannot currently show                |
| BUG-15 no Cache-Control on hits          | not visible here; the win is requests the browser never makes                          |

## Micro-benchmark findings

**BUG-20 is not a footgun, it is the dominant cost of that function.**
`isAnimatedGif` copies the entire payload one byte at a time in JS to read about
eight bytes near the front.

| payload | current      | reads in place | ratio      |
| ------- | ------------ | -------------- | ---------- |
| 64 B    | 3,392,246 hz | 18,055,111 hz  | 5x         |
| 64 kB   | 18,384 hz    | 18,081,866 hz  | 984x       |
| 512 kB  | 2,399 hz     | 21,883,418 hz  | **7,568x** |

The cost scales linearly with payload, so it grows with exactly the images the
proxy exists to handle. The reference implementation is in the bench file and is
not a proposed fix; it exists to put a number on the waste.

**URL generation is not a bottleneck.** A full 19-candidate srcset costs about
13 µs across all three providers, and single calls run at 1.5-1.9 M/sec. If page
loads feel slow, this is not why. Worth knowing before optimising the wrong
thing.

**Cache lookup is flat.** Hit and miss both run around 20 M/sec with 10,000
entries held, so the unbounded-growth problem in BUG-16 is a memory concern, not
a speed one.

## Fixtures

Generated at runtime, never committed as binaries, so they cannot drift from the
installed sharp version. No `Math.random`: identical bytes every run, or the
benchmark measures noise.

The benchmark uses its own generator (`benchmark/fixtures.ts`) rather than the
test suite's. The test helpers draw a smooth linear gradient, which is fine for
asserting behaviour but actively misleading for measuring compression: a
gradient is near the best case PNG will ever see, and lanczos resampling
destroys the long identical runs it depends on. An 800x600 gradient PNG resized
to 400w came out **larger** than the original (105,980 -> 106,523 bytes), which
made the proxy look broken when it was not. The benchmark generator sums
sinusoids at several frequencies and adds a hard-edged object and fine grain, so
resizing saves 74-99%, which is where real images land.
