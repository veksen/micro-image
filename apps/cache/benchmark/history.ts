/**
 * Renders the benchmark trend from history.jsonl.
 *
 * Run with:
 *   npm run benchmark:history -w apps/cache
 *   npm run benchmark:history -w apps/cache -- --html
 *   npm run benchmark:history -w apps/cache -- --limit 40
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const HISTORY = join(__dirname, "history.jsonl");
const HTML_OUT = join(__dirname, "history.html");

const AS_HTML = process.argv.includes("--html");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 60;

interface ScenarioEntry {
  name: string;
  originBytes: number;
  servedBytes: number;
  savedPercent: number;
  passedThroughUnprocessed: boolean;
  originFetchesPerRequest: number;
  cacheControlOnHit: boolean;
  coldMs: number;
  warmMs: number;
  coldRatio?: number;
  warmRatio?: number;
}

interface Entry {
  capturedAt: string;
  commit?: string;
  branch?: string;
  platform: string;
  node: string;
  calibration?: { version: number; sharpMs: number; jsMs: number };
  unprocessedCount: number;
  noCacheControlCount: number;
  herdUpstreamFetches: number;
  scenarios: ScenarioEntry[];
}

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

const COUNTS: Array<[string, (e: Entry) => number]> = [
  ["returned unprocessed", (e) => e.unprocessedCount],
  ["no Cache-Control on hit", (e) => e.noCacheControlCount],
  ["herd upstream fetches", (e) => e.herdUpstreamFetches],
];

const COUNT_LABELS = COUNTS.map(([label]) => label);

/**
 * Scaled against the series' own min and max. A flat series renders flat rather
 * than as noise amplified to full height.
 */
function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < Number.EPSILON) return BLOCKS[0]!.repeat(values.length);
  return values
    .map((v) => {
      const index = Math.round(((v - min) / (max - min)) * (BLOCKS.length - 1));
      return BLOCKS[index]!;
    })
    .join("");
}

function pct(current: number, first: number): string {
  if (first === 0) return current === 0 ? "=" : "new";
  const change = (current - first) / first;
  if (Math.abs(change) < 0.001) return "=";
  return `${change > 0 ? "+" : ""}${(change * 100).toFixed(1)}%`;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

function load(): Entry[] {
  if (!existsSync(HISTORY)) {
    console.error(`no history at ${HISTORY}`);
    console.error("record the first point with:");
    console.error("  npm run benchmark -w apps/cache -- --append-history");
    process.exit(1);
  }
  const entries = readFileSync(HISTORY, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Entry);

  return entries.slice(-LIMIT);
}

function renderTerminal(entries: Entry[]) {
  const first = entries[0]!;
  const last = entries[entries.length - 1]!;

  console.log(`\nbenchmark history — ${entries.length} points`);
  console.log(
    `${first.capturedAt.slice(0, 10)} → ${last.capturedAt.slice(0, 10)}  ` +
      `(${last.platform}, node ${last.node})\n`
  );

  const names = last.scenarios.map((s) => s.name);
  // the behavioural-count labels are longer than most scenario names, so the
  // column has to accommodate both or the last block goes ragged
  const width = Math.max(...names.map((n) => n.length), ...COUNT_LABELS.map((l) => l.length), 8);

  // bytes served: the deterministic series, so it leads
  console.log("served bytes");
  console.log(
    `${"scenario".padEnd(width)}  ${"trend".padEnd(entries.length)}  ${"now".padStart(10)}  ${"vs first".padStart(9)}`
  );
  console.log("-".repeat(width + entries.length + 25));

  for (const name of names) {
    const series = entries
      .map((e) => e.scenarios.find((s) => s.name === name)?.servedBytes)
      .filter((v): v is number => v !== undefined);
    if (series.length === 0) continue;

    console.log(
      `${name.padEnd(width)}  ${sparkline(series).padEnd(entries.length)}  ` +
        `${kb(series[series.length - 1]!).padStart(10)}  ${pct(series[series.length - 1]!, series[0]!).padStart(9)}`
    );
  }

  // calibrated cold time: comparable across machines, unlike raw ms
  const hasRatios = entries.some((e) => e.scenarios.some((s) => s.coldRatio !== undefined));
  if (hasRatios) {
    console.log("\ncold time, calibrated (1.00 = one reference sharp resize)");
    console.log(
      `${"scenario".padEnd(width)}  ${"trend".padEnd(entries.length)}  ${"now".padStart(10)}  ${"vs first".padStart(9)}`
    );
    console.log("-".repeat(width + entries.length + 25));

    for (const name of names) {
      const series = entries
        .map((e) => e.scenarios.find((s) => s.name === name)?.coldRatio)
        .filter((v): v is number => v !== undefined);
      if (series.length === 0) continue;

      console.log(
        `${name.padEnd(width)}  ${sparkline(series).padEnd(entries.length)}  ` +
          `${series[series.length - 1]!.toFixed(2).padStart(10)}  ${pct(series[series.length - 1]!, series[0]!).padStart(9)}`
      );
    }
  }

  // behavioural counts: exact, and each one is a bug still open
  console.log("\nbehavioural counts");
  console.log(
    `${"metric".padEnd(width)}  ${"trend".padEnd(entries.length)}  ${"now".padStart(10)}  ${"vs first".padStart(9)}`
  );
  console.log("-".repeat(width + entries.length + 25));

  for (const [label, pick] of COUNTS) {
    const series = entries.map(pick);
    const first = series[0]!;
    const now = series[series.length - 1]!;
    const change = first === now ? "=" : `${first} → ${now}`;
    console.log(
      `${label.padEnd(width)}  ${sparkline(series).padEnd(entries.length)}  ` +
        `${String(now).padStart(10)}  ${change.padStart(9)}`
    );
  }

  const drift = calibrationDrift(entries);
  if (drift) console.log(`\n${drift}`);
  console.log();
}

/** Warns when the runners themselves changed speed a lot. */
function calibrationDrift(entries: Entry[]): string | undefined {
  const values = entries
    .map((e) => e.calibration?.sharpMs)
    .filter((v): v is number => v !== undefined);
  if (values.length < 2) return undefined;

  const min = Math.min(...values);
  const max = Math.max(...values);
  return (
    `calibration ranged ${min.toFixed(1)}–${max.toFixed(1)}ms across these runs ` +
    `(${(max / min).toFixed(1)}x). Ratios absorb this; raw ms do not.`
  );
}

function renderHtml(entries: Entry[]) {
  const names = entries[entries.length - 1]!.scenarios.map((s) => s.name);

  const chart = (title: string, series: Array<{ label: string; values: number[] }>) => {
    const w = 720;
    const h = 220;
    const pad = 34;
    const all = series.flatMap((s) => s.values);
    const min = Math.min(...all, 0);
    const max = Math.max(...all);
    const span = max - min || 1;
    const x = (i: number, n: number) => pad + (i / Math.max(1, n - 1)) * (w - pad * 2);
    const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
    const colors = [
      "#2563eb",
      "#dc2626",
      "#059669",
      "#d97706",
      "#7c3aed",
      "#0891b2",
      "#be185d",
      "#4b5563",
    ];

    const paths = series
      .map((s, index) => {
        const d = s.values
          .map(
            (v, i) => `${i === 0 ? "M" : "L"}${x(i, s.values.length).toFixed(1)},${y(v).toFixed(1)}`
          )
          .join(" ");
        return `<path d="${d}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="2"/>`;
      })
      .join("");

    const legend = series
      .map(
        (s, index) =>
          `<span class="key"><i style="background:${colors[index % colors.length]}"></i>${s.label}</span>`
      )
      .join("");

    return `<section><h2>${title}</h2><svg viewBox="0 0 ${w} ${h}" role="img">
      <line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="currentColor" opacity=".25"/>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${h - pad}" stroke="currentColor" opacity=".25"/>
      <text x="${pad}" y="${pad - 12}" font-size="11" fill="currentColor" opacity=".6">${max.toFixed(max > 100 ? 0 : 2)}</text>
      <text x="${pad}" y="${h - pad + 16}" font-size="11" fill="currentColor" opacity=".6">${min.toFixed(min > 100 ? 0 : 2)}</text>
      ${paths}</svg><div class="legend">${legend}</div></section>`;
  };

  const bytesSeries = names.map((name) => ({
    label: name,
    values: entries.map((e) => (e.scenarios.find((s) => s.name === name)?.servedBytes ?? 0) / 1024),
  }));
  const ratioSeries = names.map((name) => ({
    label: name,
    values: entries.map((e) => e.scenarios.find((s) => s.name === name)?.coldRatio ?? 0),
  }));
  const countSeries = [
    { label: "returned unprocessed", values: entries.map((e) => e.unprocessedCount) },
    { label: "no Cache-Control on hit", values: entries.map((e) => e.noCacheControlCount) },
    { label: "herd upstream fetches", values: entries.map((e) => e.herdUpstreamFetches) },
  ];

  const html = `<!doctype html><meta charset="utf-8"><title>micro-image benchmark history</title>
<style>
:root{color-scheme:light dark}
body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:2rem auto;max-width:800px;padding:0 1rem}
h1{font-size:1.4rem;margin-bottom:.25rem}
h2{font-size:1rem;margin:2rem 0 .5rem}
.meta{opacity:.7;margin-bottom:1rem}
svg{width:100%;height:auto;border:1px solid color-mix(in srgb,currentColor 15%,transparent);border-radius:6px}
.legend{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:.5rem;font-size:12px}
.key{display:flex;align-items:center;gap:.35rem}
.key i{width:10px;height:10px;border-radius:2px;display:inline-block}
footer{margin-top:2rem;opacity:.7;font-size:12px}
</style>
<h1>micro-image benchmark history</h1>
<div class="meta">${entries.length} points, ${entries[0]!.capturedAt.slice(0, 10)} to ${entries[entries.length - 1]!.capturedAt.slice(0, 10)}</div>
${chart("Served bytes (kB) — deterministic", bytesSeries)}
${chart("Cold time, calibrated (1.00 = one reference sharp resize)", ratioSeries)}
${chart("Behavioural counts — each is an open bug", countSeries)}
<footer>Generated from history.jsonl. Byte counts and behavioural counts reproduce; raw wall-clock does not, which is why cold time is shown as a ratio against a fixed calibration workload.</footer>`;

  writeFileSync(HTML_OUT, html);
  console.log(`wrote ${HTML_OUT}`);
}

const entries = load();
if (AS_HTML) {
  renderHtml(entries);
} else {
  renderTerminal(entries);
}
