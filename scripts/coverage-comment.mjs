#!/usr/bin/env node
// Renders every package's coverage as ONE markdown table for ONE sticky pull
// request comment, posted by .github/workflows/test.yml.
//
// Packages are discovered by glob, so a newly tested package appears on its own
// — there is no hand-maintained list here or in test.yml to drift against.
//
// Writes the markdown to stdout, to --out <file>, and to $GITHUB_STEP_SUMMARY
// when set, so a push to main gets a readable report with no comment at all.
//
// Usage:
//   node scripts/coverage-comment.mjs [--baseline <dir>] [--base-ref <ref>] [--out <file>]

import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = "<!-- micro-image-coverage -->";

// Presentation bands only. Nothing here fails the build, and none of the vitest
// configs set `coverage.thresholds`. That is deliberate: BUGS.md pins known bugs
// with `it.fails` ledger tests, so this repo's coverage is honestly incomplete
// by design. A gate here would push people to delete ledger tests to go green,
// which is the one thing .claude/skills/testing forbids.
const GREEN = 80;
const YELLOW = 60;

const METRICS = ["lines", "statements", "branches", "functions"];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readSummary(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.warn(`Skipping unreadable summary ${path}: ${err.message}`);
    return null;
  }
}

/** Every package that produced a coverage-summary.json, in stable path order. */
function discoverPackages() {
  return globSync("{apps,packages}/*/coverage/coverage-summary.json", {
    cwd: ROOT,
  })
    .map((rel) => rel.replace(/[/\\]coverage[/\\]coverage-summary\.json$/, ""))
    .map((name) => name.split("\\").join("/"))
    .sort();
}

const pct = (metric) =>
  !metric || metric.total === 0 ? null : (metric.covered / metric.total) * 100;

const fmtPct = (value) => (value === null ? "—" : `${value.toFixed(1)}%`);

function fmtDelta(current, baseline) {
  if (current === null || baseline === null) return "—";
  const diff = current - baseline;
  // Sub-0.05 rounds to 0.0; calling that a change is noise, not signal.
  if (Math.abs(diff) < 0.05) return "±0.0";
  // U+2212 minus, not a hyphen — aligns with + at the same glyph width.
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)}`;
}

function dot(value) {
  if (value === null) return "⚪";
  if (value >= GREEN) return "🟢";
  if (value >= YELLOW) return "🟡";
  return "🔴";
}

/** Sum covered/total across packages — a mean of percentages would weight a
 * 20-line package the same as a 5000-line one. */
function aggregate(summaries) {
  const totals = {};
  for (const metric of METRICS) {
    totals[metric] = { covered: 0, total: 0 };
    for (const summary of summaries) {
      const entry = summary?.total?.[metric];
      if (!entry) continue;
      totals[metric].covered += entry.covered;
      totals[metric].total += entry.total;
    }
  }
  return { total: totals };
}

const columns = (summary) => ({
  cells: METRICS.map((metric) => pct(summary?.total?.[metric])),
});

function row(label, summary, baseline) {
  const { cells } = columns(summary);
  return {
    label,
    delta: fmtDelta(cells[0], pct(baseline?.total?.lines)),
    cells,
  };
}

function renderTable(rows) {
  const head = [
    "|  | Package | Lines | Δ | Statements | Branches | Functions |",
    "|:--:|---|--:|--:|--:|--:|--:|",
  ];
  const body = rows.map((r) => {
    const [lines, statements, branches, functions] = r.cells;
    return `| ${dot(lines)} | ${r.label} | ${fmtPct(lines)} | ${r.delta} | ${fmtPct(statements)} | ${fmtPct(branches)} | ${fmtPct(functions)} |`;
  });
  return [...head, ...body].join("\n");
}

/** Alert type drives the comment's colour, and GitHub themes it for us. */
function renderHeadline(total, delta) {
  const summary = `**${fmtPct(pct(total.total.lines))} overall**`;

  if (delta === "—") {
    return `> [!NOTE]\n> ${summary} · no \`main\` baseline to compare against`;
  }
  if (delta === "±0.0") {
    return `> [!NOTE]\n> ${summary} · unchanged vs \`main\``;
  }
  const rose = delta.startsWith("+");
  const points = delta.slice(1);
  return `> [!${rose ? "TIP" : "WARNING"}]\n> ${summary} · ${rose ? "up" : "down"} ${points} points vs \`main\``;
}

function changedFiles(baseRef) {
  if (!baseRef) return [];
  try {
    return execFileSync(
      "git",
      ["diff", "--name-only", `${baseRef}...HEAD`, "--", "*.ts", "*.tsx"],
      { cwd: ROOT, encoding: "utf-8" }
    )
      .split("\n")
      .filter((f) => f && !/\.(test|spec|bench)\.tsx?$/.test(f));
  } catch (err) {
    console.warn(`Could not diff against ${baseRef}: ${err.message}`);
    return [];
  }
}

/**
 * Coverage keys are absolute paths from the runner that produced them, so they
 * cannot be compared to git's repo-relative paths directly. Match on the tail.
 */
function renderChangedFiles(files, summaries) {
  const rows = [];
  for (const file of files) {
    for (const summary of summaries) {
      const key = Object.keys(summary).find(
        (k) => k !== "total" && k.split("\\").join("/").endsWith(`/${file}`)
      );
      if (!key) continue;
      const lines = pct(summary[key].lines);
      rows.push(
        `| ${dot(lines)} | \`${file}\` | ${fmtPct(lines)} | ${fmtPct(pct(summary[key].branches))} | ${fmtPct(pct(summary[key].functions))} |`
      );
      break;
    }
  }
  if (rows.length === 0) return "";
  return [
    "",
    `<details><summary>Changed files with coverage (${rows.length})</summary>`,
    "",
    "|  | File | Lines | Branches | Functions |",
    "|:--:|---|--:|--:|--:|",
    ...rows,
    "",
    "</details>",
  ].join("\n");
}

function main() {
  const baselineDir = arg("--baseline");
  const baseRef = arg("--base-ref");
  const outFile = arg("--out");

  const packages = discoverPackages();
  if (packages.length === 0) {
    console.error("No coverage-summary.json found under apps/* or packages/*.");
    process.exit(1);
  }

  const summaries = [];
  const rows = [];
  // Packages present in BOTH runs. The total delta is computed over these only:
  // aggregating all-of-current against a baseline that predates a newly tested
  // package would book that package's whole contribution as a coverage change.
  const pairedCurrent = [];
  const pairedBaseline = [];

  for (const name of packages) {
    const summary = readSummary(resolve(ROOT, name, "coverage/coverage-summary.json"));
    if (!summary) continue;
    summaries.push(summary);
    const baseline = baselineDir
      ? readSummary(resolve(ROOT, baselineDir, name, "coverage/coverage-summary.json"))
      : null;
    if (baseline) {
      pairedCurrent.push(summary);
      pairedBaseline.push(baseline);
    }
    rows.push(row(name, summary, baseline));
  }

  const total = aggregate(summaries);
  const totalDelta =
    pairedBaseline.length > 0
      ? fmtDelta(
          pct(aggregate(pairedCurrent).total.lines),
          pct(aggregate(pairedBaseline).total.lines)
        )
      : "—";

  const totalRow = { label: "**Total**", delta: totalDelta, ...columns(total) };

  const markdown = [
    MARKER,
    renderHeadline(total, totalDelta),
    "",
    renderTable([totalRow, ...rows]),
    // Empty when the PR touched no covered file; drop it rather than leaving a
    // gap above the legend.
    renderChangedFiles(changedFiles(baseRef), summaries) || null,
    "",
    `<sub>🟢 ≥${GREEN}% · 🟡 ≥${YELLOW}% · 🔴 <${YELLOW}% · ⚪ nothing to measure — indicative bands, not a build gate.</sub>`,
  ]
    .filter((section) => section !== null)
    .join("\n");

  process.stdout.write(`${markdown}\n`);
  if (outFile) writeFileSync(resolve(ROOT, outFile), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, { flag: "a" });
  }
}

main();
