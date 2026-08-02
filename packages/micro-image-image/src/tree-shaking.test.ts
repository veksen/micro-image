import { rolldown } from "rolldown";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const SELECTED = "micro-image";

/**
 * This file has no single source to sit beside, so it breaks the colocation rule
 * in `.claude/skills/testing/conventions.md`. What it tests is the package's whole
 * entry graph — `index.tsx` through `image-cache-provider.tsx` into `providers/` —
 * and the defect it pins (BUG-35) is a property of the graph, not of one module.
 */

/** Every provider module, read from disk so a newly added one is covered without an edit here. */
async function providerNames(): Promise<string[]> {
  const files = await readdir(join(SRC, "providers"));
  return files
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))
    .map((file) => basename(file, ".ts"))
    .filter((name) => name !== "base" && !name.endsWith(".test") && !name.endsWith(".bench"));
}

/**
 * Bundles a minimal consumer against the package source and reports how much of
 * each provider module survived tree-shaking.
 *
 * The module graph is the assertion, not the byte count. Rolldown keeps an entry
 * in `chunk.modules` for every module it visited and sets `renderedLength` to the
 * source it actually kept, so a fully shaken provider reads as 0 — and a provider
 * dropped from the graph entirely reads as 0 too, which is the same answer.
 * Matching identifiers in the minified output would not work: minification renames
 * them. Byte counts live in `scripts/provider-size.mjs`; a budget would churn on a
 * pre-1.0 library, and the structural fact is the one worth gating on.
 *
 * Source, not `dist/`: the `test` task does not depend on `build`, and the shape of
 * the code is the subject. The packaging is already right — `sideEffects: false`
 * and real ESM. See docs/adr/0011-provider-selection.md.
 */
async function retainedProviderBytes(): Promise<Record<string, number>> {
  const dir = await mkdtemp(join(tmpdir(), "micro-image-shake-"));
  const consumer = join(dir, "consumer.js");

  // Written without JSX so the fixture needs no transform of its own.
  await writeFile(
    consumer,
    `import { createElement } from "react";
import Image, { ImageCacheProvider } from ${JSON.stringify(join(SRC, "index.tsx"))};

export const App = () =>
  createElement(
    ImageCacheProvider,
    { provider: ${JSON.stringify(SELECTED)}, cacheProxyUrl: "https://cdn.example.com/cache" },
    createElement(Image, {
      src: "https://example.com/hero.jpg",
      width: 1600,
      height: 900,
      alt: "hero",
    }),
  );
`
  );

  const build = await rolldown({
    input: consumer,
    external: ["react", "react-dom", "react/jsx-runtime"],
    treeshake: true,
  });
  const { output } = await build.generate({ format: "esm", minify: true });
  await build.close();

  const chunk = output.find((entry) => entry.type === "chunk");
  if (!chunk || chunk.type !== "chunk") {
    throw new Error("rolldown produced no chunk for the consumer fixture");
  }

  const retained: Record<string, number> = {};
  for (const provider of await providerNames()) {
    const suffix = join("providers", `${provider}.ts`);
    const visited = Object.entries(chunk.modules).find(([id]) => id.endsWith(suffix));
    retained[provider] = visited ? visited[1].renderedLength : 0;
  }
  return retained;
}

describe("provider tree-shaking", () => {
  let retained: Record<string, number>;
  let unselected: string[];

  // One bundle for the whole file; rolldown takes a moment.
  beforeAll(async () => {
    retained = await retainedProviderBytes();
    unselected = Object.keys(retained).filter((provider) => provider !== SELECTED);
  }, 60_000);

  // Guards the two below: if the module ids stopped matching, every provider would
  // read as 0 and the ledger test would pass for the wrong reason.
  it("finds the provider the consumer actually selected", () => {
    expect(retained[SELECTED]).toBeGreaterThan(0);
    expect(unselected.length).toBeGreaterThan(0);
  });

  it("ships every unselected provider to the consumer anyway [BUG-35]", () => {
    expect(unselected.filter((provider) => retained[provider] > 0)).toEqual(unselected);
  });

  it.fails("BUG-35: a consumer that selects one provider should ship no other", () => {
    expect(unselected.filter((provider) => retained[provider] > 0)).toEqual([]);
  });
});
