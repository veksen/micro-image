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
import { clearCache } from "../src/cache";
import { execFileSync } from "child_process";
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
  /** coldMs.p50 divided by the calibration run, comparable across machines. */
  coldRatio?: number;
  warmRatio?: number;
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
      note: "BUG-21: never cached, refetched every request",
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
  let servedBytes = 0;
  let cacheControlOnHit = false;

  const fetchesBefore = origin.hits[scenario.path] || 0;

  for (let i = 0; i < ITERATIONS; i++) {
    clearCache();

    const coldStart = performance.now();
    const cold = await get();
    coldSamples.push(performance.now() - coldStart);

    const warmStart = performance.now();
    const warm = await get();
    warmSamples.push(performance.now() - warmStart);

    servedBytes = cold.rawPayload.byteLength;
    cacheControlOnHit = warm.headers["cache-control"] !== undefined;
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
    originFetchesPerRequest: fetches / (ITERATIONS * 2),
    cacheControlOnHit,
    note: scenario.note,
  };
}

async function runHerdScenario(app: FastifyInstance, origin: Origin) {
  const path = "/herd.jpg";
  const url = `${origin.url}${path}`;
  const before = origin.hits[path] || 0;

  clearCache();
  const start = performance.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, () =>
      app.inject({ method: "GET", url: "/cache", query: { image: url, width: "400" } })
    )
  );
  const elapsed = performance.now() - start;

  return {
    concurrency: CONCURRENCY,
    upstreamFetches: (origin.hits[path] || 0) - before,
    wallMs: elapsed,
  };
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

function report(
  results: ScenarioResult[],
  herd: Awaited<ReturnType<typeof runHerdScenario>>,
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
  columns.push("cold ms", "warm ms");
  if (baseline) columns.push("Δ cold");

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
    row.push(ms(r.coldMs.p50), ms(r.warmMs.p50));
    if (baseline) {
      row.push(before ? delta(r.coldMs.p50, before.coldMs.p50) : "     new");
    }
    console.log(row.join("  "));
  }

  if (baseline) {
    console.log(
      "\nΔ served is deterministic and meaningful. Δ cold is wall-clock on this\n" +
        "machine and will move on its own; read it as a trend, not a result."
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
}

/**
 * When running in GitHub Actions, append a table to the job summary so the
 * numbers are visible on the PR without downloading an artifact.
 */
function writeJobSummary(
  results: ScenarioResult[],
  herd: Awaited<ReturnType<typeof runHerdScenario>>,
  baseline?: Baseline
) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;

  const byName = new Map((baseline?.results ?? []).map((r) => [r.name, r]));
  const lines: string[] = [];

  lines.push("## Proxy benchmark", "");
  lines.push(
    `${ITERATIONS} iterations per scenario on \`${process.platform}-${process.arch}\`, node ${process.version}.`,
    ""
  );

  const head = ["scenario", "origin kB", "served kB", "saved %"];
  if (baseline) head.push("Δ served");
  head.push("cold ms", "warm ms");
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
    row.push(r.coldMs.p50.toFixed(2), r.warmMs.p50.toFixed(2));
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
    `- thundering herd: **${herd.upstreamFetches}** upstream fetches for ${herd.concurrency} concurrent cold requests`
  );
  lines.push("");
  lines.push(
    "_Timings are wall-clock on a shared runner and move on their own. " +
      "Only byte counts and the counts above are reproducible._"
  );

  appendFileSync(target, lines.join("\n") + "\n");
}

/** Best-effort git metadata; the benchmark still runs outside a checkout. */
function gitInfo() {
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
  return { commit: run(["rev-parse", "HEAD"]), branch: run(["rev-parse", "--abbrev-ref", "HEAD"]) };
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
  calibration: Calibration
) {
  const { commit, branch } = gitInfo();
  const entry = {
    capturedAt: new Date().toISOString(),
    commit,
    branch,
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    iterations: ITERATIONS,
    calibration,
    unprocessedCount: results.filter(
      (r) => r.passedThroughUnprocessed && r.contentType !== "image/gif"
    ).length,
    noCacheControlCount: results.filter((r) => !r.cacheControlOnHit).length,
    herdUpstreamFetches: herd.upstreamFetches,
    scenarios: results.map((r) => ({
      name: r.name,
      originBytes: r.originBytes,
      servedBytes: r.servedBytes,
      savedPercent: Number(r.savedPercent.toFixed(2)),
      passedThroughUnprocessed: r.passedThroughUnprocessed,
      originFetchesPerRequest: Number(r.originFetchesPerRequest.toFixed(3)),
      cacheControlOnHit: r.cacheControlOnHit,
      coldMs: Number(r.coldMs.p50.toFixed(3)),
      warmMs: Number(r.warmMs.p50.toFixed(3)),
      coldRatio: r.coldRatio !== undefined ? Number(r.coldRatio.toFixed(4)) : undefined,
      warmRatio: r.warmRatio !== undefined ? Number(r.warmRatio.toFixed(4)) : undefined,
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

  for (const result of results) {
    result.coldRatio = result.coldMs.p50 / calibration.sharpMs;
    result.warmRatio = result.warmMs.p50 / calibration.sharpMs;
  }

  const baseline = SAVE_BASELINE ? undefined : loadBaseline();
  report(results, herd, baseline);
  writeJobSummary(results, herd, baseline);

  const payload = {
    capturedAt: new Date().toISOString(),
    iterations: ITERATIONS,
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    calibration,
    results,
    herd,
  };

  if (APPEND_HISTORY) {
    appendHistory(results, herd, calibration);
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
