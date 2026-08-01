#!/usr/bin/env node
// Design-rule lint for the UI layer (.claude/skills/design/design.md, [lint]-tagged rules).
// oxlint can't see Tailwind class-string semantics, so this is a focused regex
// pass over component source. It is a ratchet, not a one-shot cleanup: existing
// violations are grandfathered in design-lint-baseline.json so CI stays green,
// while any NEW violation in a non-baselined file fails. Burn the baseline down
// file-by-file; the script also fails on a stale entry (a baselined file that no
// longer violates) so the list can't rot.

import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = resolve(ROOT, "scripts/design-lint-baseline.json");

// The UI layer: the docs site, plus the published component (inline styles, no
// Tailwind). Tests and their helpers assert on class strings, so they are out of scope.
const GLOBS = ["apps/docs/src/**/*.{ts,tsx}", "packages/micro-image-image/src/**/*.tsx"];
const EXCLUDE = /(\.test\.|test-helpers\.)/;

const RULES = [
  {
    id: "no-arbitrary-color",
    // Tailwind arbitrary color value, e.g. bg-[#EEFC25], text-[#2a3e42].
    re: /-\[#[0-9a-fA-F]{3,8}\]/,
    hint: "Use an @theme token, not a hard-coded hex. Use a radix scale utility (bg-slate-3, text-slate-12) or add an @theme token in apps/docs/src/globals.css.",
  },
  {
    id: "no-rgb-hsl-literal",
    // Literal rgb()/hsl() in a class or style. color-mix(... var(--token) ...) is fine.
    re: /\b(rgba?|hsla?)\(/,
    hint: "Use an @theme token / color-mix over a token, not a literal rgb()/hsl().",
  },
  {
    id: "no-default-accent",
    // Reflex AI accent — must be a deliberate @theme brand token instead.
    re: /\b(bg|text|border|ring|from|via|to|outline|decoration|divide|accent|fill|stroke)-(purple|indigo|violet|fuchsia)-\d{2,3}\b/,
    hint: "No purple/indigo-by-default accent (the canonical AI-slop tell). Use a brand token defined in @theme, chosen for a reason.",
  },
  {
    id: "no-bare-focus",
    // Tailwind focus: variant without -visible/-within.
    re: /\bfocus:(?!visible|within)/,
    hint: "Style focus with focus-visible:, never bare focus:.",
  },
  {
    id: "no-disable-paste",
    re: /onPaste=\{[^}]*preventDefault/,
    hint: "Never disable paste on an input/textarea.",
  },
];

function listFiles() {
  const seen = new Set();
  for (const pattern of GLOBS) {
    for (const f of globSync(pattern, { cwd: ROOT })) {
      const rel = f.split("\\").join("/");
      if (!EXCLUDE.test(rel)) seen.add(rel);
    }
  }
  return [...seen].sort();
}

function findViolations(files) {
  const byFile = new Map();
  for (const file of files) {
    const lines = readFileSync(resolve(ROOT, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        const m = rule.re.exec(line);
        if (!m) continue;
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file).push({
          line: i + 1,
          col: m.index + 1,
          id: rule.id,
          hint: rule.hint,
          snippet: line.trim().slice(0, 100),
        });
      }
    });
  }
  return byFile;
}

function loadBaseline() {
  try {
    return new Set(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));
  } catch {
    return new Set();
  }
}

const files = listFiles();
const byFile = findViolations(files);
const baseline = loadBaseline();

const fresh = []; // violations in non-baselined files — hard fail
const stale = []; // baselined files that are now clean — fail so baseline can shrink

for (const [file, hits] of byFile) {
  if (!baseline.has(file)) fresh.push([file, hits]);
}
for (const file of baseline) {
  if (!byFile.has(file)) stale.push(file);
}

if (fresh.length === 0 && stale.length === 0) {
  const grandfathered = baseline.size;
  console.log(
    `design-lint: ok — 0 new violations` +
      (grandfathered ? `, ${grandfathered} file(s) still on the burn-down baseline` : "")
  );
  process.exit(0);
}

if (fresh.length > 0) {
  console.error(`\ndesign-lint: ${fresh.length} file(s) with new design-rule violations\n`);
  for (const [file, hits] of fresh) {
    for (const h of hits) {
      console.error(`  ${file}:${h.line}:${h.col}  ${h.id}`);
      console.error(`      ${h.snippet}`);
      console.error(`      → ${h.hint}`);
    }
  }
  console.error(
    `\nFix these (see .claude/skills/design/design.md). If a violation is genuinely` +
      ` unavoidable, add the file to scripts/design-lint-baseline.json with a reason in the PR.`
  );
}

if (stale.length > 0) {
  console.error(
    `\ndesign-lint: ${stale.length} baselined file(s) are now clean — remove from the baseline:`
  );
  for (const file of stale) console.error(`  ${file}`);
  console.error(`\nEdit scripts/design-lint-baseline.json so the ratchet can't be undone.`);
}

process.exit(1);
