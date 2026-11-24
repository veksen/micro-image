import { describe, it, expect } from "vitest";
import {
  type BenchCell,
  type BenchFetch,
  type BenchImage,
  type BenchResults,
  compare,
  regressions,
  summarize,
} from "./compare";

function fetch(overrides: Partial<BenchFetch> = {}): BenchFetch {
  return {
    width: 800,
    placeholder: false,
    kb: 50,
    phase: "html",
    cacheControl: true,
    ...overrides,
  };
}

function image(index: number, overrides: Partial<BenchImage> = {}): BenchImage {
  const phase = index === 0 ? "html" : "scroll";
  return {
    index,
    neededWidth: 768,
    fit: 1.04,
    upstream: 0,
    fetches: [fetch({ phase })],
    ...overrides,
  };
}

function cell(overrides: Partial<BenchCell> = {}): BenchCell {
  return {
    layout: "column",
    strategy: "shipped",
    viewport: "1920@1",
    cls: 0,
    images: [image(0), image(1), image(2)],
    ...overrides,
  };
}

function results(cells: BenchCell[], failures: string[] = []): BenchResults {
  return { cells, failures, missing: [] };
}

/** `cell()` with the eager image replaced. */
function withEager(overrides: Partial<BenchImage>): BenchCell {
  return cell({ images: [image(0, overrides), image(1), image(2)] });
}

describe("summarize", () => {
  it("reads the eager image, the lazy ones and the bytes before the scroll apart", () => {
    const summary = summarize(
      withEager({ fetches: [fetch({ placeholder: true, kb: 3 }), fetch({ phase: "script" })] })
    );

    expect(summary.eagerWidths).toBe("ph→800");
    expect(summary.eagerKb).toBe(53);
    expect(summary.eagerPhase).toBe("script");
    expect(summary.lazyKb).toBe(100);
    expect(summary.requests).toBe(4);
    expect(summary.beforeScrollKb).toBe(53);
  });
});

describe("regressions", () => {
  it("finds none between identical cells", () => {
    expect(regressions(cell(), cell())).toEqual([]);
  });

  it("ignores a byte difference the size of a response header", () => {
    expect(regressions(cell(), withEager({ fetches: [fetch({ kb: 50.3 })] }))).toEqual([]);
  });

  it("flags more bytes, which also arrive before the scroll", () => {
    expect(regressions(cell(), withEager({ fetches: [fetch({ kb: 60 })] }))).toEqual([
      "more bytes",
      "more bytes before the scroll",
    ]);
  });

  it("flags a lazy image moved before the scroll even when the total holds", () => {
    const head = cell({ images: [image(0), image(1, { fetches: [fetch()] }), image(2)] });

    expect(regressions(cell(), head)).toEqual(["more bytes before the scroll"]);
  });

  it("flags an extra request", () => {
    const head = withEager({ fetches: [fetch({ placeholder: true, kb: 0 }), fetch()] });

    expect(regressions(cell(), head)).toEqual(["more requests"]);
  });

  it("flags an image that got blurrier, and not one that stayed sharp but got smaller", () => {
    expect(regressions(cell(), withEager({ fit: 0.9 }))).toEqual(["blurrier image 0"]);
    expect(regressions(withEager({ fit: 1.5 }), withEager({ fit: 1.1 }))).toEqual([]);
  });

  it("flags an eager image that starts in a later phase", () => {
    expect(regressions(cell(), withEager({ fetches: [fetch({ phase: "script" })] }))).toEqual([
      "eager image starts later",
    ]);
    expect(regressions(withEager({ fetches: [fetch({ phase: "script" })] }), cell())).toEqual([]);
  });

  it("flags the proxy going upstream on a warm cache", () => {
    expect(regressions(cell(), withEager({ upstream: 1 }))).toEqual(["more upstream fetches"]);
  });

  it("flags a response that lost its Cache-Control", () => {
    expect(regressions(cell(), withEager({ fetches: [fetch({ cacheControl: false })] }))).toEqual([
      "responses without Cache-Control",
    ]);
  });

  it("flags more layout shift", () => {
    expect(regressions(cell(), cell({ cls: 0.05 }))).toEqual(["more layout shift"]);
  });
});

describe("compare", () => {
  it("passes and folds every cell away when nothing changed", () => {
    const { markdown, regressed } = compare(results([cell()]), results([cell()]));

    expect(regressed).toEqual([]);
    expect(markdown).toContain("No cell regressed");
    expect(markdown).toContain("<details><summary>1 unchanged cell(s)</summary>");
  });

  it("shows a changed value as base → head and names the regression", () => {
    const head = withEager({ fetches: [fetch({ kb: 60 })] });
    const { markdown, regressed } = compare(results([cell()]), results([head]));

    expect(regressed).toEqual(["column shipped 1920@1: more bytes, more bytes before the scroll"]);
    expect(markdown).toContain("| 50 → **60** |");
  });

  it("lists a strategy the base branch predates without failing on it", () => {
    const added = cell({ strategy: "shipped+sizes" });
    const { markdown, regressed } = compare(results([cell()]), results([cell(), added]));

    expect(regressed).toEqual([]);
    expect(markdown).toContain("| column shipped+sizes 1920@1 |");
    expect(markdown).toContain("only on head");
  });

  it("fails when head could not measure a cell", () => {
    const failure = "column shipped 1920@1: timeout";
    const { markdown, regressed } = compare(results([cell()]), results([], [failure]));

    expect(regressed).toEqual([`failed on head: ${failure}`]);
    expect(markdown).toContain(`- head ${failure}`);
    expect(markdown).not.toContain("Only on base");
  });
});
