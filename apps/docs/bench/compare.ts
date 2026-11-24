/**
 * Compares two browser benchmark runs and fails on a deterministic regression.
 *
 *   vite-node bench/compare.ts <base results.json> <head results.json> <out.md>
 *
 * Writes the comparison as Markdown, for the PR comment and the job summary,
 * and exits 1 when any cell regressed or failed on head. See `src/bench/compare.ts`.
 */
import { readFileSync, writeFileSync } from "fs";
import { compare, type BenchResults } from "../src/bench/compare";

const [basePath, headPath, outPath] = process.argv.slice(2);
if (!basePath || !headPath || !outPath) {
  throw new Error("usage: compare.ts <base results.json> <head results.json> <out.md>");
}

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as BenchResults;
const { markdown, regressed } = compare(read(basePath), read(headPath));

writeFileSync(outPath, markdown);
console.log(markdown);
if (regressed.length > 0) {
  console.error(`\n${regressed.length} regression(s):\n${regressed.join("\n")}`);
  process.exitCode = 1;
}
