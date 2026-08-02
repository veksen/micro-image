/**
 * End-to-end benchmark for the image proxy.
 *
 * Measures the two things the product actually claims: how many bytes it saves,
 * and how long it takes to save them. Runs the real Fastify route against a
 * real local HTTP origin with real sharp compression.
 *
 * What the timings are and are not:
 *   - the origin is on 127.0.0.1 and requests go through `fastify.inject()`, so
 *     there is no wire latency in either direction
 *   - what is measured is server-side work: download, decode, resize, encode,
 *     and cache lookup
 *   - byte counts are deterministic; timings are not, and will vary by machine
 *
 * Run with: npm run benchmark -w apps/cache
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from "fs";
import { dirname, join } from "path";
import { performance } from "perf_hooks";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server";
import { clearCache, cacheBytes, cacheSize, cacheMaxBytes, setCacheMaxBytes } from "../src/cache";
import { execFileSync } from "child_process";
import os from "os";
import { makeGif, startOrigin, type Origin } from "../src/test-helpers";
import { photoJpeg, photoPng, photoWebp } from "./fixtures";
import { calibrate, type Calibration } from "./calibration";

const ITERATIONS = Number(process.env.BENCH_ITERATIONS) || 15;
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY) || 8;
const OUT = process.env.BENCH_OUT || join(__dirname, "results.json");
const BASELINE = join(__dirname, "baseline.json");

const HISTORY = join(__dirname, "history.jsonl");

const SAVE_BASELINE = process.argv.includes("--save-baseline");
const APPEND_HISTORY = process.argv.includes("--append-history");

/**
 * Byte counts are reproducible across platforms, but not to the exact byte.
 * Measured darwin-arm64 vs linux-x64, same sharp 0.33.2 / libvips 8.15.1:
 * every JPEG figure was identical, while PNG differed by 2-5 bytes out of
 * ~1.2 MB (a different zlib build). 0.1% comfortably absorbs that and still
 * catches any real change in what the proxy emits.
 */
const BYTE_TOLERANCE = 0.001;

/**
 * Calibration cancels machine speed. It does not cancel everything.
 *
 * Measured by running an unchanged commit on darwin-arm64 against a CI Linux
 * runner: raw milliseconds moved +50% to +73% on every scenario, and the
 * calibrated ratio moved by up to about 25%. So calibration removes most of the
 * cross-machine difference and leaves a quarter of it, from scheduling, cache
 * behaviour and a libvips build that is not identical.
 *
 * The tolerance is set from that measurement rather than chosen. A tighter one
 * reports hardware as a regression, which is the failure this column exists to
 * stop.
 */
const TIMING_TOLERANCE = 0.25;

/**
 * Below this, a scenario is not worth comparing.
 *
 * The passthrough scenarios finish in well under a millisecond and perform no
 * sharp work at all, so dividing them by a sharp calibration is the wrong
 * denominator: they measure fixed per-request overhead, which does not scale
 * with the reference workload. On CI they swung 52% and 85% while doing nothing
 * differently.
 */
const TIMING_FLOOR_MS = 2;

interface Scenario {
  name: string;
  path: string;
  body: Buffer;
  contentType: string;
  /** Query sent to /cache, minus the image param. */
  query: Record<string, string>;
  note?: string;
}

interface ScenarioResult {
  name: string;
  contentType: string;
  query: Record<string, string>;
  originBytes: number;
  servedBytes: number;
  savedPercent: number;
  passedThroughUnprocessed: boolean;
  coldMs: Stats;
  warmMs: Stats;
  /** CPU time consumed, user plus system. Exceeds wall time when sharp threads. */
  coldCpuMs: Stats;
  warmCpuMs: Stats;
  /** coldMs.p50 divided by the calibration run, comparable across machines. */
  coldRatio?: number;
  warmRatio?: number;
  coldCpuRatio?: number;
  /** Bytes this scenario's response occupies in the unbounded cache. */
  retainedBytesPerEntry: number;
  originFetchesPerRequest: number;
  cacheControlOnHit: boolean;
  note?: string;
}

interface Stats {
  mean: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  /**
   * Every sample, not just the summary.
   *
   * Summaries cannot be re-analysed. Trimmed means, outlier rejection, MAD and
   * bootstrapped intervals all need the distribution, so a better methodology
   * arriving later can only be applied to points that kept their raw numbers.
   * Keeping them costs a few kB per point.
   */
  samples: number[];
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  return {
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    p50: at(0.5),
    p95: at(0.95),
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    samples: samples.map((v) => Number(v.toFixed(4))),
  };
}

function ms(value: number): string {
  return value.toFixed(2).padStart(8);
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(1).padStart(8);
}

async function buildScenarios(): Promise<Scenario[]> {
  const big = { width: 1600, height: 1200 };

  return [
    {
      name: "jpeg q80 -> 400w",
      path: "/q80.jpg",
      body: await photoJpeg({ ...big, quality: 80 }),
      contentType: "image/jpeg",
      query: { width: "400" },
      note: "the intended path: resize + recompress",
    },
    {
      name: "jpeg q100 -> 400w",
      path: "/q100.jpg",
      body: await photoJpeg({ ...big, quality: 100 }),
      contentType: "image/jpeg",
      query: { width: "400" },
      note: "BUG-18: quantization table trips the gif check",
    },
    {
      name: "jpeg q60 -> 400w",
      path: "/q60.jpg",
      body: await photoJpeg({ ...big, quality: 60 }),
      contentType: "image/jpeg",
      query: { width: "400" },
      note: "BUG-18: same, at a different quality",
    },
    {
      name: "jpeg q80 -> blur",
      path: "/blur.jpg",
      body: await photoJpeg({ ...big, quality: 80 }),
      contentType: "image/jpeg",
      query: { width: "400", blur: "true" },
      note: "blur radius is hardcoded to 10 server-side (BUG-2)",
    },
    {
      name: "png 800x600 -> 400w",
      path: "/photo.png",
      body: await photoPng({ width: 800, height: 600 }),
      contentType: "image/png",
      query: { width: "400" },
    },
    {
      name: "webp 800x600 -> 400w",
      path: "/photo.webp",
      body: await photoWebp({ width: 800, height: 600 }),
      contentType: "image/webp",
      query: { width: "400" },
    },
    {
      name: "animated gif",
      path: "/anim.gif",
      body: makeGif({ delay: 10 }),
      contentType: "image/gif",
      query: { width: "400" },
      note: "correctly passed through untouched",
    },
    {
      name: "svg (unsupported)",
      path: "/icon.svg",
      body: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>'
      ),
      contentType: "image/svg+xml",
      query: {},
      note: "relayed untransformed, and cached so it costs one upstream fetch",
    },
  ];
}

async function runScenario(
  app: FastifyInstance,
  origin: Origin,
  scenario: Scenario
): Promise<ScenarioResult> {
  const url = `${origin.url}${scenario.path}`;
  const query = { image: url, ...scenario.query };
  const get = () => app.inject({ method: "GET", url: "/cache", query });

  const coldSamples: number[] = [];
  const warmSamples: number[] = [];
  const coldCpuSamples: number[] = [];
  const warmCpuSamples: number[] = [];
  let servedBytes = 0;
  let cacheControlOnHit = false;
  let retainedBytesPerEntry = 0;

  // one discarded pass: the first request through a route pays JIT warmup,
  // which showed up as ~2x the CPU of every subsequent request
  clearCache();
  await get();
  await get();

  // counted after the warmup, or its fetches inflate the per-request ratio
  const fetchesBefore = origin.hits[scenario.path] || 0;

  for (let i = 0; i < ITERATIONS; i++) {
    clearCache();

    const coldCpu = process.cpuUsage();
    const coldStart = performance.now();
    const cold = await get();
    coldSamples.push(performance.now() - coldStart);
    const coldCpuDelta = process.cpuUsage(coldCpu);
    coldCpuSamples.push((coldCpuDelta.user + coldCpuDelta.system) / 1000);

    const warmCpu = process.cpuUsage();
    const warmStart = performance.now();
    const warm = await get();
    warmSamples.push(performance.now() - warmStart);
    const warmCpuDelta = process.cpuUsage(warmCpu);
    warmCpuSamples.push((warmCpuDelta.user + warmCpuDelta.system) / 1000);

    servedBytes = cold.rawPayload.byteLength;
    cacheControlOnHit = warm.headers["cache-control"] !== undefined;
    // what one cached variant of this scenario costs in retained memory
    retainedBytesPerEntry = cacheSize() > 0 ? cacheBytes() / cacheSize() : 0;
  }

  const fetches = (origin.hits[scenario.path] || 0) - fetchesBefore;

  return {
    name: scenario.name,
    contentType: scenario.contentType,
    query: scenario.query,
    originBytes: scenario.body.byteLength,
    servedBytes,
    savedPercent: (1 - servedBytes / scenario.body.byteLength) * 100,
    // identical bytes means the route short-circuited and did no work
    passedThroughUnprocessed: servedBytes === scenario.body.byteLength,
    coldMs: stats(coldSamples),
    warmMs: stats(warmSamples),
    coldCpuMs: stats(coldCpuSamples),
    warmCpuMs: stats(warmCpuSamples),
    retainedBytesPerEntry,
    // the two discarded warmup requests are not counted against the total
    originFetchesPerRequest: fetches / (ITERATIONS * 2),
    cacheControlOnHit,
    note: scenario.note,
  };
}

/**
 * The cost of no request coalescing.
 *
 * Wall time barely moves when N cold requests arrive at once, because the work
 * runs in parallel across cores. CPU time is what actually multiplies, so it is
 * the number that describes the bug.
 */
async function runHerdScenario(app: FastifyInstance, origin: Origin) {
  const path = "/herd.jpg";
  const url = `${origin.url}${path}`;
  const fire = (n: number) =>
    Promise.all(
      Array.from({ length: n }, () =>
        app.inject({ method: "GET", url: "/cache", query: { image: url, width: "400" } })
      )
    );

  // warm the JIT so the comparison is not measuring first-call compilation
  clearCache();
  await fire(1);

  /**
   * Both sides are sampled repeatedly and reduced to a median.
   *
   * A single sample each was enough while the ratio was ~11x, because the
   * signal swamped the noise. Once requests coalesce the two sides do nearly
   * identical work, so one noisy sample can put the ratio below 1, which reads
   * as "eight requests cost less CPU than one" and is nonsense.
   */
  const REPEATS = 5;
  const measure = async (n: number) => {
    clearCache();
    const cpu = process.cpuUsage();
    const start = performance.now();
    await fire(n);
    const delta = process.cpuUsage(cpu);
    return {
      wallMs: performance.now() - start,
      cpuMs: (delta.user + delta.system) / 1000,
    };
  };

  const singles: Array<{ wallMs: number; cpuMs: number }> = [];
  const herds: Array<{ wallMs: number; cpuMs: number }> = [];
  let fetches = 0;

  for (let i = 0; i < REPEATS; i++) {
    singles.push(await measure(1));

    const before = origin.hits[path] || 0;
    herds.push(await measure(CONCURRENCY));
    fetches = (origin.hits[path] || 0) - before;
  }

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };

  return {
    concurrency: CONCURRENCY,
    // from the final round; every round performs the same number
    upstreamFetches: fetches,
    wallMs: median(herds.map((h) => h.wallMs)),
    cpuMs: median(herds.map((h) => h.cpuMs)),
    singleWallMs: median(singles.map((s) => s.wallMs)),
    singleCpuMs: median(singles.map((s) => s.cpuMs)),
    repeats: REPEATS,
  };
}

/**
 * What the cache does under a flood of distinct keys.
 *
 * `?width=` is attacker-controlled and unbounded, so each distinct value mints
 * an entry. This drives that directly and reports what the cache ended up
 * holding against its budget.
 *
 * A smaller budget than production's default is used, so the bound is crossed
 * without allocating a quarter of a gigabyte. Both numbers are reported, so the
 * result cannot be read as "it fit".
 */
const PRESSURE_KEYS = Number(process.env.BENCH_PRESSURE_KEYS) || 200;
const PRESSURE_BUDGET = Number(process.env.BENCH_PRESSURE_BUDGET) || 128 * 1024;

async function runCachePressureScenario(app: FastifyInstance, origin: Origin) {
  const url = `${origin.url}/q100.jpg`;
  const configured = cacheMaxBytes();

  clearCache();
  setCacheMaxBytes(PRESSURE_BUDGET);

  let requestedBytes = 0;
  for (let i = 0; i < PRESSURE_KEYS; i++) {
    const res = await app.inject({
      method: "GET",
      url: "/cache",
      query: { image: url, width: String(100 + i) },
    });
    requestedBytes += res.rawPayload.byteLength;
  }

  const result = {
    distinctKeys: PRESSURE_KEYS,
    budgetBytes: PRESSURE_BUDGET,
    retainedBytes: cacheBytes(),
    entries: cacheSize(),
    // what an unbounded cache would have been holding by now
    unboundedBytes: requestedBytes,
    withinBudget: cacheBytes() <= PRESSURE_BUDGET,
    // Did the flood actually reach the budget? Without this, a workload that
    // never approaches the bound reports "within budget" and reads as proof
    // that eviction works, having exercised none of it. That happened once:
    // fixing the animated-gif false positive shrank each cached variant from
    // 1.4 MB to about 2 kB, and 60 keys stopped crossing a 32 MB budget.
    exercisedEviction: requestedBytes > PRESSURE_BUDGET,
  };

  clearCache();
  setCacheMaxBytes(configured);
  return result;
}

interface Baseline {
  capturedAt?: string;
  platform: string;
  node: string;
  results: ScenarioResult[];
  herd: { concurrency: number; upstreamFetches: number; wallMs: number };
}

function loadBaseline(): Baseline | undefined {
  if (!existsSync(BASELINE)) return undefined;
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8")) as Baseline;
  } catch {
    console.warn(`could not parse ${BASELINE}, ignoring it`);
    return undefined;
  }
}

/** "-91.2%" for a shrink, "+3.4%" for a growth, "=" inside the tolerance. */
function delta(current: number, previous: number, tolerance = 0): string {
  if (previous === 0) return current === 0 ? "       =" : "     new";
  const change = (current - previous) / previous;
  if (Math.abs(change) <= tolerance) return "       =";
  return `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`.padStart(8);
}

/**
 * Cold-time change against the baseline, compared as calibrated ratios and
 * suppressed where the scenario is too fast for the comparison to mean
 * anything.
 */
function calibratedDelta(current: ScenarioResult, before?: ScenarioResult): string {
  if (!before || before.coldRatio === undefined || current.coldRatio === undefined) {
    return "n/a";
  }
  // Both sides, not either. A scenario that was trivial and is now substantial
  // has changed in the way most worth reporting: the quality-60 jpeg went from
  // 1.8ms to 10.5ms when it stopped being passed through unprocessed.
  if (current.coldMs.p50 < TIMING_FLOOR_MS && before.coldMs.p50 < TIMING_FLOOR_MS) {
    return "too fast";
  }

  return delta(current.coldRatio, before.coldRatio, TIMING_TOLERANCE);
}

function report(
  results: ScenarioResult[],
  herd: Awaited<ReturnType<typeof runHerdScenario>>,
  pressure: Awaited<ReturnType<typeof runCachePressureScenario>>,
  baseline?: Baseline
) {
  console.log(`\nproxy benchmark — ${ITERATIONS} iterations per scenario\n`);

  if (baseline) {
    console.log(
      `comparing against baseline captured on ${baseline.platform}` +
        `${baseline.capturedAt ? ` at ${baseline.capturedAt}` : ""}\n`
    );
  }

  const byName = new Map((baseline?.results ?? []).map((r) => [r.name, r]));

  const columns = ["scenario".padEnd(22), "origin kB", "served kB", "saved %".padStart(8)];
  if (baseline) columns.push("Δ served");
  columns.push("cold ms", "cold cpu", "warm ms");
  if (baseline) columns.push("Δ cold*");

  const header = columns.join("  ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const r of results) {
    const before = byName.get(r.name);
    const row = [
      r.name.padEnd(22),
      kb(r.originBytes),
      kb(r.servedBytes),
      `${r.savedPercent.toFixed(1).padStart(7)}%`,
    ];
    if (baseline) {
      row.push(before ? delta(r.servedBytes, before.servedBytes, BYTE_TOLERANCE) : "     new");
    }
    row.push(ms(r.coldMs.p50), ms(r.coldCpuMs.p50), ms(r.warmMs.p50));
    if (baseline) {
      // Compared as a ratio against each run's own calibration, not as raw ms.
      // Raw ms across machines measures the machine: the same unchanged code
      // read +50% to +73% on a CI runner purely for being slower hardware,
      // which looks exactly like a regression.
      row.push(calibratedDelta(r, before).padStart(8));
    }
    console.log(row.join("  "));
  }

  if (baseline) {
    const samePlatform = baseline.platform === `${process.platform}-${process.arch}`;
    console.log(
      `\nΔ served is deterministic. Δ cold* is calibrated: each timing is divided\n` +
        `by a fixed reference workload measured in the same run, so it compares\n` +
        `across machines. Raw cold/warm ms are this machine only.` +
        (samePlatform
          ? ""
          : `\nBaseline came from ${baseline.platform}; this ran on ` +
            `${process.platform}-${process.arch}, which is exactly the case the\n` +
            `calibration exists for.`)
    );
  }

  const unprocessed = results.filter(
    (r) => r.passedThroughUnprocessed && r.contentType !== "image/gif"
  );
  if (unprocessed.length > 0) {
    console.log(`\nreturned unprocessed (no resize, no recompression):`);
    for (const r of unprocessed) {
      console.log(`  ${r.name.padEnd(22)} ${r.note ?? ""}`);
    }
  }

  const uncached = results.filter((r) => r.originFetchesPerRequest > 0.5);
  if (uncached.length > 0) {
    console.log(`\nrefetched from origin on every request:`);
    for (const r of uncached) {
      console.log(`  ${r.name.padEnd(22)} ${r.originFetchesPerRequest.toFixed(2)} fetches/request`);
    }
  }

  const noCacheControl = results.filter((r) => !r.cacheControlOnHit);
  if (noCacheControl.length > 0) {
    console.log(
      `\nno Cache-Control on cache hit (BUG-15): ${noCacheControl.length}/${results.length} scenarios`
    );
  }

  console.log(
    `\nthundering herd: ${herd.concurrency} concurrent cold requests caused ` +
      `${herd.upstreamFetches} upstream fetches in ${herd.wallMs.toFixed(0)}ms`
  );
  console.log(
    `  cpu ${herd.singleCpuMs.toFixed(0)}ms for 1 request, ` +
      `${herd.cpuMs.toFixed(0)}ms for ${herd.concurrency} ` +
      `(${(herd.cpuMs / herd.singleCpuMs).toFixed(1)}x cpu, ` +
      `${(herd.wallMs / herd.singleWallMs).toFixed(1)}x wall)`
  );
  console.log("  wall time barely moves because the work runs across cores; cpu is the cost");

  console.log(
    `\ncache under pressure: ${pressure.distinctKeys} distinct keys, ` +
      `${(pressure.unboundedBytes / 1024).toFixed(0)} kB requested, ` +
      `${(pressure.retainedBytes / 1024).toFixed(0)} kB retained ` +
      `against a ${(pressure.budgetBytes / 1024).toFixed(0)} kB budget ` +
      `(${pressure.entries} entries kept, within budget: ${pressure.withinBudget})`
  );
  if (!pressure.exercisedEviction) {
    console.log(
      "  WARNING: the flood never reached the budget, so eviction was not " +
        "exercised. Raise BENCH_PRESSURE_KEYS or lower BENCH_PRESSURE_BUDGET."
    );
  }

  const retained = [...results].sort((a, b) => b.retainedBytesPerEntry - a.retainedBytesPerEntry);
  console.log("\nmemory retained per cached variant:");
  for (const r of retained.slice(0, 3)) {
    console.log(`  ${r.name.padEnd(22)} ${kb(r.retainedBytesPerEntry)} kB per entry`);
  }
  const worst = retained[0]!;
  const best = retained[retained.length - 1]!;
  if (best.retainedBytesPerEntry > 0) {
    console.log(
      `  worst is ${(worst.retainedBytesPerEntry / best.retainedBytesPerEntry).toFixed(0)}x the smallest, ` +
        `so the byte budget fills at very different rates depending on the mix`
    );
  }
}

/**
 * Renders the results table as markdown and publishes it two ways: appended to
 * the GitHub Actions job summary when running in CI, and written to a file that
 * the workflow posts as a pull request comment. The file is always written, so a
 * local run produces the same markdown a reviewer would see.
 */
function writeSummary(
  results: ScenarioResult[],
  herd: Awaited<ReturnType<typeof runHerdScenario>>,
  pressure: Awaited<ReturnType<typeof runCachePressureScenario>>,
  baseline?: Baseline
) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  const markdownOut = process.env.BENCH_MARKDOWN_OUT || join(__dirname, "summary.md");

  const byName = new Map((baseline?.results ?? []).map((r) => [r.name, r]));
  const lines: string[] = [];

  const { commit } = gitInfo();
  lines.push("## Proxy benchmark", "");
  lines.push(
    `${ITERATIONS} iterations per scenario on \`${process.platform}-${process.arch}\`, ` +
      `node ${process.version}${commit ? `, commit \`${commit.slice(0, 7)}\`` : ""}.`,
    ""
  );

  const head = ["scenario", "origin kB", "served kB", "saved %"];
  if (baseline) head.push("Δ served");
  head.push("cold ms", "cold cpu", "warm ms", "retained kB");
  if (baseline) head.push("Δ cold*");
  lines.push(`| ${head.join(" | ")} |`);
  lines.push(`| ${head.map(() => "---").join(" | ")} |`);

  for (const r of results) {
    const before = byName.get(r.name);
    const row = [
      r.name,
      (r.originBytes / 1024).toFixed(1),
      (r.servedBytes / 1024).toFixed(1),
      `${r.savedPercent.toFixed(1)}%`,
    ];
    if (baseline) {
      row.push(before ? delta(r.servedBytes, before.servedBytes, BYTE_TOLERANCE).trim() : "new");
    }
    row.push(r.coldMs.p50.toFixed(2), r.coldCpuMs.p50.toFixed(2), r.warmMs.p50.toFixed(2));
    row.push((r.retainedBytesPerEntry / 1024).toFixed(1));
    if (baseline) {
      row.push(calibratedDelta(r, before).trim());
    }
    lines.push(`| ${row.join(" | ")} |`);
  }

  const unprocessed = results.filter(
    (r) => r.passedThroughUnprocessed && r.contentType !== "image/gif"
  );
  lines.push("");
  lines.push(
    `- returned unprocessed: **${unprocessed.length}** (${unprocessed.map((r) => r.name).join(", ") || "none"})`
  );
  lines.push(
    `- no Cache-Control on hit: **${results.filter((r) => !r.cacheControlOnHit).length}/${results.length}**`
  );
  lines.push(
    `- cache under pressure: **${(pressure.retainedBytes / 1024 / 1024).toFixed(1)} MB** retained ` +
      `from ${(pressure.unboundedBytes / 1024 / 1024).toFixed(1)} MB requested across ` +
      `${pressure.distinctKeys} distinct keys, against a ` +
      `${(pressure.budgetBytes / 1024).toFixed(0)} kB budget` +
      (pressure.exercisedEviction ? "" : " — **budget never reached, eviction not exercised**")
  );
  lines.push(
    `- thundering herd: **${herd.upstreamFetches}** upstream fetches for ${herd.concurrency} concurrent cold requests, ` +
      `costing **${(herd.cpuMs / herd.singleCpuMs).toFixed(1)}x** the CPU of one but only ` +
      `${(herd.wallMs / herd.singleWallMs).toFixed(1)}x the wall time`
  );
  lines.push("");
  lines.push(
    "_`Δ cold*` is calibrated: each timing is divided by a fixed reference " +
      "workload measured in the same run, so it survives being compared across " +
      "machines. Raw `cold ms` / `cold cpu` / `warm ms` are this runner only and " +
      "will differ from the baseline for reasons that are not the code. Byte " +
      "counts and the counts above reproduce exactly._"
  );

  const markdown = lines.join("\n") + "\n";

  // the job summary page, for whoever opens the run
  if (target) appendFileSync(target, markdown);

  // and a file, so CI can post the same table as a PR comment
  writeFileSync(markdownOut, markdown);
}

/** Best-effort git metadata; the benchmark still runs outside a checkout. */
function gitInfo() {
  // On a pull_request event the workspace sits on an ephemeral merge commit, so
  // `git rev-parse HEAD` returns a sha that appears nowhere in the branch. CI
  // passes the real head sha through BENCH_COMMIT.
  const override = process.env.BENCH_COMMIT;
  const run = (args: string[]) => {
    try {
      return execFileSync("git", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return undefined;
    }
  };
  return {
    commit: override || run(["rev-parse", "HEAD"]),
    branch: run(["rev-parse", "--abbrev-ref", "HEAD"]),
  };
}

/**
 * One JSON object per line, appended in commit order. Committed to the repo, so
 * the trend survives without a service and can be read with plain git.
 *
 * Byte counts, behavioural counts and calibrated ratios are the point. Raw
 * wall-clock is kept alongside for reference, but the trend reads the ratios.
 */
function appendHistory(
  results: ScenarioResult[],
  herd: Awaited<ReturnType<typeof runHerdScenario>>,
  pressure: Awaited<ReturnType<typeof runCachePressureScenario>>,
  calibration: Calibration
) {
  const { commit, branch } = gitInfo();
  const cpus = os.cpus();
  const entry = {
    // 1: p50 only. 2: raw samples, CPU time, retained bytes, machine details.
    // Points at schema 1 cannot be re-analysed with a different summary method.
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    commit,
    branch,
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    // recorded so a later noise model can account for the machine
    machine: {
      cpuModel: cpus[0]?.model,
      cores: cpus.length,
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      ci: Boolean(process.env.CI),
    },
    iterations: ITERATIONS,
    calibration,
    unprocessedCount: results.filter(
      (r) => r.passedThroughUnprocessed && r.contentType !== "image/gif"
    ).length,
    noCacheControlCount: results.filter((r) => !r.cacheControlOnHit).length,
    herdUpstreamFetches: herd.upstreamFetches,
    herd,
    cachePressure: pressure,
    totalRetainedBytesPerRound: results.reduce((t, r) => t + r.retainedBytesPerEntry, 0),
    scenarios: results.map((r) => ({
      name: r.name,
      originBytes: r.originBytes,
      servedBytes: r.servedBytes,
      savedPercent: Number(r.savedPercent.toFixed(2)),
      passedThroughUnprocessed: r.passedThroughUnprocessed,
      originFetchesPerRequest: Number(r.originFetchesPerRequest.toFixed(3)),
      cacheControlOnHit: r.cacheControlOnHit,
      retainedBytesPerEntry: r.retainedBytesPerEntry,
      coldMs: Number(r.coldMs.p50.toFixed(3)),
      warmMs: Number(r.warmMs.p50.toFixed(3)),
      coldCpuMs: Number(r.coldCpuMs.p50.toFixed(3)),
      warmCpuMs: Number(r.warmCpuMs.p50.toFixed(3)),
      coldRatio: r.coldRatio !== undefined ? Number(r.coldRatio.toFixed(4)) : undefined,
      warmRatio: r.warmRatio !== undefined ? Number(r.warmRatio.toFixed(4)) : undefined,
      coldCpuRatio: r.coldCpuRatio !== undefined ? Number(r.coldCpuRatio.toFixed(4)) : undefined,
      // full distributions, so a later methodology can re-summarise this point
      samples: {
        coldMs: r.coldMs.samples,
        warmMs: r.warmMs.samples,
        coldCpuMs: r.coldCpuMs.samples,
        warmCpuMs: r.warmCpuMs.samples,
      },
    })),
  };

  appendFileSync(HISTORY, JSON.stringify(entry) + "\n");
  console.log(`appended one entry to ${HISTORY}`);
}

async function main() {
  const calibration = await calibrate();
  console.log(
    `calibration v${calibration.version}: sharp ${calibration.sharpMs.toFixed(2)}ms, ` +
      `js ${calibration.jsMs.toFixed(2)}ms`
  );

  const scenarios = await buildScenarios();
  const herdBody = await photoJpeg({ width: 1600, height: 1200, quality: 80 });

  const routes = Object.fromEntries([
    ...scenarios.map((s) => [s.path, { body: s.body, contentType: s.contentType }]),
    ["/herd.jpg", { body: herdBody, contentType: "image/jpeg" }],
  ]);

  const origin = await startOrigin(routes);
  const app = buildServer({ logger: false });

  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(app, origin, scenario));
  }
  const herd = await runHerdScenario(app, origin);
  const pressure = await runCachePressureScenario(app, origin);

  for (const result of results) {
    result.coldRatio = result.coldMs.p50 / calibration.sharpMs;
    result.warmRatio = result.warmMs.p50 / calibration.sharpMs;
    result.coldCpuRatio = result.coldCpuMs.p50 / calibration.sharpMs;
  }

  const baseline = SAVE_BASELINE ? undefined : loadBaseline();
  report(results, herd, pressure, baseline);
  writeSummary(results, herd, pressure, baseline);

  const payload = {
    capturedAt: new Date().toISOString(),
    iterations: ITERATIONS,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    calibration,
    results,
    herd,
    cachePressure: pressure,
  };

  if (APPEND_HISTORY) {
    appendHistory(results, herd, pressure, calibration);
  }

  if (SAVE_BASELINE) {
    // baseline records byte counts and behavioural counts, which reproduce.
    // Timings are kept for reference but are machine-specific by nature.
    writeFileSync(BASELINE, JSON.stringify(payload, null, 2));
    console.log(`\nwrote baseline to ${BASELINE}`);
    console.log("commit it so later runs can show the delta\n");
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(payload, null, 2));
    console.log(`\nwrote ${OUT}\n`);
  }

  await app.close();
  await origin.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
