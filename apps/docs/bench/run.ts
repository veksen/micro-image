/**
 * Browser benchmark: what each way of marking up an image costs a real page.
 *
 * Starts the built proxy and the built docs app, then loads every
 * (layout, strategy, viewport) cell of `src/pages/bench.tsx` in Chromium. Per image
 * it records the widths fetched, the bytes on the wire and the width the box
 * needed; per page, LCP and layout shift.
 *
 * Widths and bytes depend only on the markup, the viewport and a cold cache, so
 * they should match across runs; a cell where they don't is flagged. Timings
 * depend on the machine, so they are a median and never compared across
 * machines. Chromium only: nothing here speaks for Safari or Firefox.
 *
 *   npm run build && npm run benchmark -w @micro-image/docs
 *
 * BENCH_LAYOUTS, BENCH_STRATEGIES and BENCH_VIEWPORTS take comma-separated names
 * to narrow a run. BENCH_RUNS sets the measured loads per cell (3). BENCH_HAR=1
 * writes a HAR of each cell's first measured load. BENCH_THROTTLE=off drops the
 * network throttling. BENCH_OUT moves the output directory. BENCH_CHROMIUM is a
 * Chromium binary to use instead of the one playwright-core expects.
 *
 * BENCH_APP_ROOT is another checkout of this repo, already built, whose proxy and
 * docs app are measured instead of this one's. CI uses it to measure the base
 * branch with the PR's harness, so a difference between the two results comes
 * from the apps and never from the measuring code.
 */
import { spawn, type ChildProcess } from "child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createServer } from "http";
import { join, resolve } from "path";
import { chromium, type Browser, type Page } from "playwright-core";
import {
  type ImageFetch,
  type LayoutName,
  type StrategyName,
  fitRatio,
  fixtures,
  imageCount,
  layoutNames,
  layouts,
  median,
  parseImageFetch,
  strategyNames,
} from "../src/bench/model";
import type { BenchImage, BenchResults, Phase } from "../src/bench/compare";

const APP = resolve(process.env.BENCH_APP_ROOT ?? join(__dirname, "..", "..", ".."));
const DOCS = join(APP, "apps", "docs");
const CACHE = join(APP, "apps", "cache");
const FIXTURES = join(DOCS, "public", "bench");
const SOURCE = join(__dirname, "..", "public", "neom-bA32w6lebJg-unsplash.jpg");
const OUT = resolve(process.env.BENCH_OUT ?? join(__dirname, "results"));

const HOST = "127.0.0.1";
/** Serves the docs app, and the fixtures to the `next-image` row. */
const ORIGIN = `http://${HOST}:3100`;
/**
 * Serves the fixtures to the proxy, and is the one origin the proxy is told to
 * trust. It is a separate server so the runner can count what the proxy fetches.
 */
const FIXTURE_ORIGIN = `http://${HOST}:3101`;
// the proxy binds `localhost` (apps/cache/src/index.ts)
const PROXY_ROOT = "http://localhost:4100";
const PROXY = `${PROXY_ROOT}/cache`;

const RUNS = Number(process.env.BENCH_RUNS) || 3;
const HAR = process.env.BENCH_HAR === "1";
/**
 * Fast enough that a page finishes, slow enough that bytes show up in the
 * timings. Unthrottled, an observer's correction lands after the first fetch has
 * finished instead of while it is in flight, which changes what it costs.
 */
const THROTTLE =
  process.env.BENCH_THROTTLE === "off"
    ? undefined
    : {
        latency: 40,
        downloadThroughput: (10 * 1024 * 1024) / 8,
        uploadThroughput: (5 * 1024 * 1024) / 8,
      };

interface Viewport {
  name: string;
  width: number;
  height: number;
  dpr: number;
  mobile: boolean;
}

const viewports: Viewport[] = [
  { name: "375@3", width: 375, height: 812, dpr: 3, mobile: true },
  { name: "768@2", width: 768, height: 1024, dpr: 2, mobile: true },
  { name: "1280@1", width: 1280, height: 800, dpr: 1, mobile: false },
  { name: "1280@2", width: 1280, height: 800, dpr: 2, mobile: false },
  { name: "1920@1", width: 1920, height: 1080, dpr: 1, mobile: false },
];

/** The items an env var names, or all of them when it is unset. */
function only<T>(all: readonly T[], env: string | undefined, nameOf: (item: T) => string): T[] {
  if (!env) return [...all];
  const wanted = env.split(",");
  const unknown = wanted.filter((name) => !all.some((item) => nameOf(item) === name));
  if (unknown.length > 0) throw new Error(`unknown value(s): ${unknown.join(", ")}`);
  return all.filter((item) => wanted.includes(nameOf(item)));
}

const layoutsToRun = only(layoutNames, process.env.BENCH_LAYOUTS, String);
const strategiesToRun = only(strategyNames, process.env.BENCH_STRATEGIES, String);
const viewportsToRun = only(viewports, process.env.BENCH_VIEWPORTS, (v) => v.name);

async function main() {
  if (
    !existsSync(join(DOCS, ".next", "BUILD_ID")) ||
    !existsSync(join(CACHE, "dist", "index.js"))
  ) {
    throw new Error("build first: npm run build");
  }
  // a server left on any of the ports would answer and be measured instead
  for (const url of [ORIGIN, FIXTURE_ORIGIN, PROXY_ROOT]) {
    if (await isUp(url)) throw new Error(`${url} is already in use`);
  }

  // `next start` lists public/ once at startup, so every fixture name has to exist
  // before it starts; the small ones are overwritten once the proxy can cut them
  rmSync(FIXTURES, { recursive: true, force: true });
  mkdirSync(FIXTURES, { recursive: true });
  for (let index = 0; index < imageCount; index++) {
    copyFileSync(SOURCE, join(FIXTURES, `large-${index}.jpg`));
    copyFileSync(SOURCE, join(FIXTURES, `small-${index}.jpg`));
  }

  const fixtureServer = serveFixtures();
  const children = [
    start("proxy", ["dist/index.js"], CACHE, { PORT: "4100", TRUSTED_ORIGINS: FIXTURE_ORIGIN }),
    start(
      "docs",
      [require.resolve("next/dist/bin/next", { paths: [DOCS] }), "start", "-H", HOST, "-p", "3100"],
      DOCS,
      { NODE_ENV: "production", BENCH_ORIGIN: FIXTURE_ORIGIN, BENCH_PROXY_URL: PROXY }
    ),
  ];
  try {
    await waitFor(PROXY_ROOT);
    await waitFor(ORIGIN);
    await cutSmallFixtures();
    const { cells, failures, missing, retries } = await measureAll();

    mkdirSync(OUT, { recursive: true });
    const results: BenchResults = {
      throttle: THROTTLE,
      runs: RUNS,
      retries,
      cells,
      failures,
      missing,
    };
    writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
    writeFileSync(join(OUT, "results.md"), markdown(cells, failures));
    console.log(`wrote ${join(OUT, "results.md")}`);
  } finally {
    children.forEach((child) => child.kill());
    fixtureServer.close();
  }
}

/** Requests the proxy made to the fixture origin, by image index. Reset per load. */
const upstreamFetches = new Map<number, number>();

/**
 * Serves `public/bench` and counts each request by the image it names, so a load
 * can report how often the proxy went upstream instead of answering from its cache.
 */
function serveFixtures() {
  const server = createServer((request, response) => {
    const match = /^\/bench\/((?:large|small)-(\d+)\.jpg)$/.exec(request.url ?? "");
    if (match === null) {
      response.writeHead(404).end();
      return;
    }
    const index = Number(match[2]);
    upstreamFetches.set(index, (upstreamFetches.get(index) ?? 0) + 1);
    response
      .writeHead(200, { "Content-Type": "image/jpeg" })
      .end(readFileSync(join(FIXTURES, match[1])));
  });
  server.listen(3101, HOST);
  return server;
}

async function measureAll() {
  const browser = await chromium.launch({ executablePath: process.env.BENCH_CHROMIUM });
  const cells: Cell[] = [];
  const failures: string[] = [];
  /** Cells this build has no page for: a base branch that predates a strategy. */
  const missing: string[] = [];
  let retries = 0;
  try {
    for (const layout of layoutsToRun) {
      for (const strategy of strategiesToRun) {
        for (const viewport of viewportsToRun) {
          const name = `${layout} ${strategy} ${viewport.name}`;
          try {
            const measured = await measure(browser, layout, strategy, viewport);
            retries += measured.retries;
            const cell = summarize(layout, strategy, viewport, measured.loads);
            cells.push(cell);
            console.log(`${name}: ${describe(cell)}`);
          } catch (error) {
            if (error instanceof NoSuchPage) {
              missing.push(name);
              console.log(`${name}: not on this build`);
              continue;
            }
            // one broken cell shouldn't cost the rest of the matrix
            failures.push(`${name}: ${(error as Error).message.split("\n")[0]}`);
            console.error(failures.at(-1));
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  return { cells, failures, missing, retries };
}

class NoSuchPage extends Error {}

function start(name: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn("node", args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  return child;
}

function isUp(url: string): Promise<boolean> {
  return fetch(url).then(
    () => true,
    () => false
  );
}

async function waitFor(url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await isUp(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`nothing came up at ${url}`);
}

/**
 * Cuts the 800px `small` fixture through the proxy, which keeps sharp out of this
 * package and doubles as the preflight: a proxy that can't fetch from the
 * fixture origin stops the run here, not as a table of failed images.
 */
async function cutSmallFixtures() {
  const source = `${FIXTURE_ORIGIN}/bench/large-0.jpg`;
  const response = await fetch(
    `${PROXY}?image=${encodeURIComponent(source)}&width=${fixtures.small.width}&format=jpeg&quality=90`
  );
  if (response.status === 403) {
    throw new Error(`the proxy refused ${FIXTURE_ORIGIN}; it has to be listed in TRUSTED_ORIGINS`);
  }
  if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
    throw new Error(
      `the proxy could not fetch a fixture: ${response.status} ${await response.text()}`
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  for (let index = 0; index < imageCount; index++) {
    writeFileSync(join(FIXTURES, `small-${index}.jpg`), bytes);
  }
}

/** One warm-up load, then RUNS measured loads, each retried once. */
async function measure(
  browser: Browser,
  layout: LayoutName,
  strategy: StrategyName,
  viewport: Viewport
): Promise<{ loads: Load[]; retries: number }> {
  const url = `${ORIGIN}/bench?strategy=${encodeURIComponent(strategy)}&layout=${layout}`;
  // fills the proxy's and Next's caches, so measured loads don't pay for encoding;
  // a cold 3840w encode under throttling can take most of a minute
  await load(browser, url, viewport, { timeout: 180_000 });

  const loads: Load[] = [];
  let retries = 0;
  for (let run = 0; run < RUNS; run++) {
    const har =
      HAR && run === 0 ? join(OUT, "har", `${layout}-${strategy}-${viewport.name}.har`) : undefined;
    const once = () => load(browser, url, viewport, { har });
    // about one load in a hundred never reaches networkidle on a long run; each
    // load is a fresh context, so retrying it biases nothing
    loads.push(
      await once().catch(() => {
        retries++;
        return once();
      })
    );
  }
  return { loads, retries };
}

interface Fetch extends ImageFetch {
  bytes: number;
  /** ms from the document request until the response finished. */
  finishedMs: number | undefined;
  phase: Phase;
  /** The proxy's response carried a Cache-Control header. */
  cacheControl: boolean;
}

interface Load {
  images: Array<{ index: number; neededWidth: number; fetches: Fetch[]; upstream: number }>;
  lcp: number | undefined;
  cls: number;
}

async function load(
  browser: Browser,
  url: string,
  viewport: Viewport,
  { timeout = 30_000, har }: { timeout?: number; har?: string } = {}
): Promise<Load> {
  // a fresh context is a cold cache; Chromium otherwise reuses a wider cached candidate
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    recordHar: har ? { path: har, content: "omit" } : undefined,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (THROTTLE) {
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...THROTTLE });
  }
  // CDP timestamps are monotonic seconds; the document request is time zero
  let navigationStart = 0;
  let scrolled = false;
  const fetches = new Map<string, Fetch>();
  cdp.on("Network.requestWillBeSent", ({ requestId, request, timestamp, type, initiator }) => {
    if (type === "Document" && navigationStart === 0) navigationStart = timestamp;
    const parsed = parseImageFetch(request.url);
    if (!parsed) return;
    // The phase is when the request could start, which a clock on a shared
    // machine can't say reproducibly: the parser found it in the HTML (an <img>
    // or a preload link), a script set it after hydration, or the scroll did.
    const phase: Phase = scrolled
      ? "scroll"
      : initiator.type === "parser" || initiator.type === "preload"
        ? "html"
        : "script";
    fetches.set(requestId, {
      ...parsed,
      bytes: 0,
      finishedMs: undefined,
      phase,
      cacheControl: false,
    });
  });
  cdp.on("Network.responseReceived", ({ requestId, response }) => {
    const fetch = fetches.get(requestId);
    if (!fetch) return;
    fetch.cacheControl = Object.keys(response.headers).some(
      (name) => name.toLowerCase() === "cache-control"
    );
  });
  cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength, timestamp }) => {
    const fetch = fetches.get(requestId);
    if (!fetch) return;
    fetch.bytes = encodedDataLength;
    fetch.finishedMs = Math.round((timestamp - navigationStart) * 1000);
  });

  upstreamFetches.clear();
  const response = await page.goto(url, { waitUntil: "networkidle" });
  if (response?.status() === 404) {
    await context.close();
    throw new NoSuchPage();
  }
  // before scrolling, which ends LCP and would add the lazy images to it
  const { lcp, cls } = await paintMetrics(page);

  scrolled = true;
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForLoadState("networkidle");
  // lazy images that start after the scroll make networkidle fire early
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await page.waitForTimeout(500);

  const boxes = await page.evaluate(
    (dpr) =>
      [...document.querySelectorAll<HTMLElement>("[data-bench-index]")].map((box) => ({
        index: Number(box.dataset.benchIndex),
        neededWidth: Math.round(box.getBoundingClientRect().width * dpr),
      })),
    viewport.dpr
  );
  await context.close();

  const all = [...fetches.values()];
  return {
    images: boxes.map((box) => ({
      ...box,
      fetches: all.filter((f) => f.index === box.index),
      upstream: upstreamFetches.get(box.index) ?? 0,
    })),
    lcp,
    cls,
  };
}

/** LCP and CLS so far; `buffered` includes entries from before this script ran. */
function paintMetrics(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ lcp: number | undefined; cls: number }>((resolve) => {
        let lcp: number | undefined;
        let cls = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) lcp = entry.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as Array<
            PerformanceEntry & { value: number; hadRecentInput: boolean }
          >) {
            if (!entry.hadRecentInput) cls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve({ lcp, cls }), 100);
      })
  );
}

interface Spread {
  median: number;
  min: number;
  max: number;
}

interface Cell {
  strategy: StrategyName;
  layout: LayoutName;
  viewport: string;
  eager: {
    neededWidth: number;
    fetchedWidths: Array<number | "placeholder">;
    /** Of the fetch left on screen. */
    fit: number | undefined;
    kb: number;
  };
  lazy: { fetches: number; kb: number; meanFit: number | undefined };
  /**
   * When the eager image's last real fetch finished. LCP can't stand in: the
   * shipped component paints a blurred placeholder first, LCP records that paint,
   * and swapping the src on the same element emits no later entry.
   */
  eagerDone: Spread | undefined;
  lcp: Spread | undefined;
  cls: number;
  /** Fetches differed between runs, so the cell's numbers are not the markup's alone. */
  unstable: boolean;
  /** Every image of the first measured load, for the CI comparison. */
  images: BenchImage[];
}

/** The fetch left on screen: the last one that isn't the shipped component's placeholder. */
function shown(fetches: Fetch[]): Fetch | undefined {
  return fetches.filter((f) => !f.placeholder).at(-1);
}

function spread(values: Array<number | undefined>): Spread | undefined {
  const present = values.filter((value) => value !== undefined);
  if (present.length === 0) return undefined;
  return { median: median(present), min: Math.min(...present), max: Math.max(...present) };
}

function kb(fetches: Fetch[]): number {
  return fetches.reduce((sum, f) => sum + f.bytes, 0) / 1024;
}

function summarize(
  layout: LayoutName,
  strategy: StrategyName,
  viewport: Viewport,
  loads: Load[]
): Cell {
  const intrinsic = layouts[layout].fixture.width;
  const fit = (image: Load["images"][number]) => {
    const width = shown(image.fetches)?.width;
    return width === undefined ? undefined : fitRatio(width, intrinsic, image.neededWidth);
  };
  const widths = (load: Load) =>
    JSON.stringify(load.images.map((image) => image.fetches.map((f) => f.width)));

  const [first] = loads;
  const [eager, ...lazy] = first.images;
  const lazyFits = lazy.map(fit).filter((value) => value !== undefined);

  return {
    strategy,
    layout,
    viewport: viewport.name,
    eager: {
      neededWidth: eager.neededWidth,
      fetchedWidths: eager.fetches.map((f) => (f.placeholder ? "placeholder" : f.width!)),
      fit: fit(eager),
      kb: kb(eager.fetches),
    },
    lazy: {
      fetches: lazy.reduce((sum, image) => sum + image.fetches.length, 0),
      kb: kb(lazy.flatMap((image) => image.fetches)),
      meanFit:
        lazyFits.length > 0 ? lazyFits.reduce((a, b) => a + b, 0) / lazyFits.length : undefined,
    },
    eagerDone: spread(loads.map((load) => shown(load.images[0].fetches)?.finishedMs)),
    lcp: spread(loads.map((load) => load.lcp)),
    cls: Math.max(...loads.map((load) => load.cls)),
    unstable: loads.some((load) => widths(load) !== widths(first)),
    images: first.images.map((image) => ({
      index: image.index,
      neededWidth: image.neededWidth,
      fit: fit(image),
      upstream: image.upstream,
      fetches: image.fetches.map((f) => ({
        width: f.width,
        placeholder: f.placeholder,
        kb: f.bytes / 1024,
        phase: f.phase,
        cacheControl: f.cacheControl,
      })),
    })),
  };
}

function fmt(value: number | undefined, digits = 2) {
  return value === undefined ? "–" : value.toFixed(digits);
}

function describe(cell: Cell): string {
  return `fit ${fmt(cell.eager.fit)} widths ${cell.eager.fetchedWidths.join("→")} done ${fmt(cell.eagerDone?.median, 0)} lcp ${fmt(cell.lcp?.median, 0)}${cell.unstable ? " UNSTABLE" : ""}`;
}

function markdown(cells: Cell[], failures: string[]): string {
  const widest = viewportsToRun.at(-1)!.name;
  const lines = [
    "# Browser benchmark",
    "",
    `Chromium, ${RUNS} runs per cell after one warm-up, ${THROTTLE ? "throttled to 10 Mbps / 40 ms" : "unthrottled"}.`,
    "Fit = delivered width ÷ needed width (box CSS px × DPR); 1.00 is exact, above wastes bytes, below is blurry.",
    "Eager cell: fit · widths fetched (ph = blurred placeholder) · KB · ms until the last real fetch finished (LCP ms). Times are medians. ⚠ = fetches differed between runs.",
    "",
  ];

  for (const layout of layoutsToRun) {
    lines.push(
      `## ${layout}`,
      "",
      `| strategy | ${viewportsToRun.map((v) => v.name).join(" | ")} | lazy KB · fit (${widest}) |`,
      `| --- | ${viewportsToRun.map(() => "---").join(" | ")} | --- |`
    );
    for (const strategy of strategiesToRun) {
      const row = viewportsToRun.map((viewport) =>
        cells.find(
          (c) => c.strategy === strategy && c.layout === layout && c.viewport === viewport.name
        )
      );
      const eager = row.map((cell) => {
        if (!cell) return "–";
        const widths = cell.eager.fetchedWidths
          .map((w) => (w === "placeholder" ? "ph" : w))
          .join("→");
        return `${fmt(cell.eager.fit)} · ${widths} · ${fmt(cell.eager.kb, 0)} · ${fmt(cell.eagerDone?.median, 0)} (${fmt(cell.lcp?.median, 0)})${cell.unstable ? " ⚠" : ""}`;
      });
      const last = row.at(-1);
      const lazy = last ? `${fmt(last.lazy.kb, 0)} · ${fmt(last.lazy.meanFit)}` : "–";
      lines.push(`| ${strategy} | ${eager.join(" | ")} | ${lazy} |`);
    }
    lines.push("");
  }

  if (failures.length > 0) {
    lines.push("## Failed cells", "", ...failures.map((failure) => `- ${failure}`), "");
  }
  return lines.join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
