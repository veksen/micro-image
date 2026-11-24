/**
 * Compares two browser benchmark runs, base and head, cell by cell. CI runs the
 * same harness against both, so every number here depends on the markup, the
 * proxy, the viewport and the pinned Chromium and sharp, never on the machine.
 * That is why a difference can fail the job. Timings are left out on purpose.
 */

/**
 * When a request could start: the parser found it in the HTML, a script set it
 * after hydration, or the scroll to the bottom of the page did.
 */
export type Phase = "html" | "script" | "scroll";

const phaseOrder: Record<Phase, number> = { html: 0, script: 1, scroll: 2 };

export interface BenchFetch {
  /** The width the URL asked for, or undefined when it names none. */
  width: number | undefined;
  /** The shipped component's blurred stand-in, not a real candidate. */
  placeholder: boolean;
  kb: number;
  phase: Phase;
  /** The proxy's response carried a Cache-Control header. */
  cacheControl: boolean;
}

export interface BenchImage {
  /** 0 is the eager image; the rest are lazy, below the fold. */
  index: number;
  neededWidth: number;
  /** Of the fetch left on screen; see `fitRatio`. */
  fit: number | undefined;
  /** Requests the proxy made to the fixture origin during the load. */
  upstream: number;
  fetches: BenchFetch[];
}

export interface BenchCell {
  layout: string;
  strategy: string;
  viewport: string;
  cls: number;
  images: BenchImage[];
}

export interface BenchResults {
  cells: BenchCell[];
  /** Cells that could not be measured. */
  failures: string[];
  /** Cells the build has no page for, such as a strategy newer than the branch. */
  missing: string[];
  [other: string]: unknown;
}

/** What a cell is judged on. */
export interface CellSummary {
  eagerWidths: string;
  eagerKb: number;
  eagerFit: number | undefined;
  /** Of the fetch left on screen. */
  eagerPhase: Phase | undefined;
  lazyKb: number;
  requests: number;
  /** Bytes requested before the scroll, which all compete with the eager image. */
  beforeScrollKb: number;
  upstream: number;
  noCacheControl: number;
  cls: number;
}

/** Below this, a byte difference is response headers, not the image. */
const kbTolerance = 0.01;

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function summarize(cell: BenchCell): CellSummary {
  const eager = cell.images.find((image) => image.index === 0);
  const lazy = cell.images.filter((image) => image.index !== 0);
  const fetches = cell.images.flatMap((image) => image.fetches);
  const eagerFetches = eager?.fetches ?? [];

  return {
    eagerWidths: eagerFetches.map((f) => (f.placeholder ? "ph" : (f.width ?? "?"))).join("→"),
    eagerKb: sum(eagerFetches.map((f) => f.kb)),
    eagerFit: eager?.fit,
    eagerPhase: eagerFetches.filter((f) => !f.placeholder).at(-1)?.phase,
    lazyKb: sum(lazy.flatMap((image) => image.fetches.map((f) => f.kb))),
    requests: fetches.length,
    beforeScrollKb: sum(fetches.filter((f) => f.phase !== "scroll").map((f) => f.kb)),
    upstream: sum(cell.images.map((image) => image.upstream)),
    noCacheControl: fetches.filter((f) => !f.cacheControl).length,
    cls: cell.cls,
  };
}

function grew(base: number, head: number): boolean {
  return head > base * (1 + kbTolerance) + 0.5;
}

/** A blurrier image: below 1 and below what base delivered. */
function blurrier(base: number | undefined, head: number | undefined): boolean {
  if (head === undefined || head >= 1) return false;
  return base === undefined || head < base - 0.005;
}

/** Every way head is deterministically worse than base, in words. Empty when it isn't. */
export function regressions(base: BenchCell, head: BenchCell): string[] {
  const b = summarize(base);
  const h = summarize(head);
  const found: string[] = [];

  if (grew(b.eagerKb + b.lazyKb, h.eagerKb + h.lazyKb)) found.push("more bytes");
  if (grew(b.beforeScrollKb, h.beforeScrollKb)) found.push("more bytes before the scroll");
  if (h.requests > b.requests) found.push("more requests");

  const blurry = head.images.filter((image) =>
    blurrier(base.images.find((other) => other.index === image.index)?.fit, image.fit)
  );
  if (blurry.length > 0) {
    found.push(`blurrier image ${blurry.map((image) => image.index).join(", ")}`);
  }

  if (
    b.eagerPhase !== undefined &&
    (h.eagerPhase === undefined || phaseOrder[h.eagerPhase] > phaseOrder[b.eagerPhase])
  ) {
    found.push("eager image starts later");
  }
  if (h.upstream > b.upstream) found.push("more upstream fetches");
  if (h.noCacheControl > b.noCacheControl) found.push("responses without Cache-Control");
  if (h.cls > b.cls + 0.001) found.push("more layout shift");

  return found;
}

function key(cell: BenchCell): string {
  return `${cell.layout} ${cell.strategy} ${cell.viewport}`;
}

function fmt(value: number | undefined, digits: number): string {
  return value === undefined ? "–" : value.toFixed(digits);
}

/** `value`, or `base → head` when they differ. */
function delta(base: string, head: string): string {
  return base === head ? head : `${base} → **${head}**`;
}

const columns: Array<[string, (s: CellSummary) => string]> = [
  ["eager widths", (s) => s.eagerWidths],
  ["eager KB", (s) => fmt(s.eagerKb, 0)],
  ["eager fit", (s) => fmt(s.eagerFit, 2)],
  ["eager starts", (s) => s.eagerPhase ?? "–"],
  ["lazy KB", (s) => fmt(s.lazyKb, 0)],
  ["requests", (s) => String(s.requests)],
  ["KB before scroll", (s) => fmt(s.beforeScrollKb, 0)],
  ["upstream", (s) => String(s.upstream)],
  ["no Cache-Control", (s) => String(s.noCacheControl)],
  ["CLS", (s) => fmt(s.cls, 3)],
];

function row(name: string, base: CellSummary | undefined, head: CellSummary, verdict: string) {
  const values = columns.map(([, read]) => (base ? delta(read(base), read(head)) : read(head)));
  return `| ${name} | ${values.join(" | ")} | ${verdict} |`;
}

const header = [
  `| cell | ${columns.map(([name]) => name).join(" | ")} | |`,
  `| --- | ${columns.map(() => "---").join(" | ")} | --- |`,
];

export interface Comparison {
  markdown: string;
  /** One line per regressed cell; the job fails when this is not empty. */
  regressed: string[];
}

export function compare(base: BenchResults, head: BenchResults): Comparison {
  const baseCells = new Map(base.cells.map((cell) => [key(cell), cell]));
  const headKeys = new Set(head.cells.map(key));

  const changed: string[] = [];
  const unchanged: string[] = [];
  const regressed: string[] = [];

  for (const cell of head.cells) {
    const name = key(cell);
    const other = baseCells.get(name);
    const summary = summarize(cell);
    if (!other) {
      changed.push(row(name, undefined, summary, "only on head"));
      continue;
    }
    const otherSummary = summarize(other);
    const found = regressions(other, cell);
    if (found.length > 0) regressed.push(`${name}: ${found.join(", ")}`);
    const same = columns.every(([, read]) => read(otherSummary) === read(summary));
    (same ? unchanged : changed).push(
      row(name, otherSummary, summary, found.length > 0 ? `⚠ ${found.join(", ")}` : "")
    );
  }
  // a cell head could not measure is a cell nobody checked
  regressed.push(...head.failures.map((failure) => `failed on head: ${failure}`));
  const gone = base.cells
    .map(key)
    .filter((name) => !headKeys.has(name) && !head.failures.some((f) => f.startsWith(`${name}:`)));

  const lines = ["## Browser benchmark", ""];
  lines.push(
    regressed.length > 0
      ? `**${regressed.length} cell(s) regressed or failed against the base branch.**`
      : "No cell regressed against the base branch.",
    "",
    "Chromium, one load per cell after a warm-up load, throttled to 10 Mbps / 40 ms. " +
      "Fit = delivered width ÷ needed width; below 1 is blurry. " +
      "Starts = when the shown image's request could start: html (found by the parser), " +
      "script (set after hydration) or scroll. Upstream = fetches the proxy made to the " +
      "origin on a warm cache. Changed values read base → **head**.",
    ""
  );
  if (changed.length > 0) {
    lines.push(...header, ...changed, "");
  }
  if (unchanged.length > 0) {
    lines.push(
      `<details><summary>${unchanged.length} unchanged cell(s)</summary>`,
      "",
      ...header,
      ...unchanged,
      "",
      "</details>",
      ""
    );
  }
  if (gone.length > 0) {
    lines.push(`Only on base: ${gone.join(", ")}.`, "");
  }
  const failures = [
    ...base.failures.map((failure) => `base ${failure}`),
    ...head.failures.map((failure) => `head ${failure}`),
  ];
  if (failures.length > 0) {
    lines.push("Failed cells:", "", ...failures.map((failure) => `- ${failure}`), "");
  }
  return { markdown: lines.join("\n"), regressed };
}
