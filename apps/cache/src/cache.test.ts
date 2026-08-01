import { describe, it, expect, beforeEach } from "vitest";
import {
  buildId,
  fromCache,
  toCache,
  clearCache,
  cacheSize,
  cacheBytes,
  cacheMaxBytes,
  setCacheMaxBytes,
  DEFAULT_MAX_BYTES,
} from "./cache";

const URL = "https://example.com/cat.jpg";

beforeEach(() => {
  clearCache();
  setCacheMaxBytes();
});

describe("buildId", () => {
  it("appends each supplied option", () => {
    expect(buildId(URL, { width: 100 })).toBe(`${URL}__width-100`);
  });

  it("omits undefined options rather than serialising them", () => {
    expect(buildId(URL, { width: 100, quality: undefined, blur: undefined })).toBe(
      `${URL}__width-100`
    );
  });

  it("returns the bare url when no option is supplied", () => {
    expect(buildId(URL, {})).toBe(URL);
    expect(buildId(URL)).toBe(URL);
  });

  it("is insensitive to the order the caller builds its object in", () => {
    // a caller must not be able to cause a miss by reordering a literal
    expect(buildId(URL, { width: 100, quality: 30, format: "webp" })).toBe(
      buildId(URL, { format: "webp", quality: 30, width: 100 })
    );
  });

  it("distinguishes every option that changes the output bytes", () => {
    const base = { width: 100, quality: 75, format: "webp", blur: 5 };

    expect(buildId(URL, base)).not.toBe(buildId(URL, { ...base, width: 200 }));
    expect(buildId(URL, base)).not.toBe(buildId(URL, { ...base, quality: 30 }));
    expect(buildId(URL, base)).not.toBe(buildId(URL, { ...base, format: "png" }));
    expect(buildId(URL, base)).not.toBe(buildId(URL, { ...base, blur: 40 }));
  });

  it("distinguishes different source urls", () => {
    expect(buildId(URL, { width: 100 })).not.toBe(
      buildId("https://example.com/dog.jpg", { width: 100 })
    );
  });
});

describe("in-memory store — current behaviour", () => {
  it("round-trips a record", () => {
    const buffer = Buffer.from("bytes");
    toCache("k", { contentType: "image/jpeg", buffer });

    expect(fromCache("k")).toEqual({ contentType: "image/jpeg", buffer });
  });

  it("returns undefined for an unknown id", () => {
    expect(fromCache("nope")).toBeUndefined();
  });

  it("overwrites an existing id", () => {
    toCache("k", { contentType: "image/jpeg", buffer: Buffer.from("a") });
    toCache("k", { contentType: "image/png", buffer: Buffer.from("bb") });

    expect(fromCache("k")?.contentType).toBe("image/png");
    expect(cacheSize()).toBe(1);
  });
});

describe("byte budget and eviction", () => {
  const record = (bytes: number) => ({ contentType: "image/jpeg", buffer: Buffer.alloc(bytes) });

  it("holds everything while under budget", () => {
    setCacheMaxBytes(1_000);
    toCache("a", record(300));
    toCache("b", record(300));

    expect(cacheSize()).toBe(2);
    expect(cacheBytes()).toBe(600);
  });

  it("never exceeds the budget", () => {
    setCacheMaxBytes(1_000);
    for (let i = 0; i < 50; i++) {
      toCache(`id-${i}`, record(300));
      expect(cacheBytes()).toBeLessThanOrEqual(1_000);
    }
  });

  it("evicts the least recently used first", () => {
    setCacheMaxBytes(1_000);
    toCache("a", record(400));
    toCache("b", record(400));
    toCache("c", record(400)); // pushes past the budget

    expect(fromCache("a")).toBeUndefined();
    expect(fromCache("b")).toBeDefined();
    expect(fromCache("c")).toBeDefined();
  });

  it("treats a read as a use, so a hot key survives a flood of cold ones", () => {
    setCacheMaxBytes(1_000);
    toCache("hot", record(300));

    for (let i = 0; i < 20; i++) {
      // touch the hot key between each cold insert
      expect(fromCache("hot")).toBeDefined();
      toCache(`cold-${i}`, record(300));
    }

    expect(fromCache("hot")).toBeDefined();
  });

  it("does not cache a record larger than the whole budget", () => {
    setCacheMaxBytes(1_000);
    toCache("kept", record(500));
    toCache("huge", record(2_000));

    expect(fromCache("huge")).toBeUndefined();
    // and it did not empty the cache trying to make room
    expect(fromCache("kept")).toBeDefined();
  });

  it("releases the bytes of a replaced id rather than double counting", () => {
    setCacheMaxBytes(1_000);
    toCache("a", record(400));
    toCache("a", record(100));

    expect(cacheSize()).toBe(1);
    expect(cacheBytes()).toBe(100);
  });

  it("defaults to a documented budget when unconfigured", () => {
    setCacheMaxBytes();

    expect(cacheMaxBytes()).toBe(DEFAULT_MAX_BYTES);
    expect(DEFAULT_MAX_BYTES).toBe(256 * 1024 * 1024);
  });
});

/**
 * BUG LEDGER
 *
 * Each test below asserts the behaviour we WANT. They are marked `.fails`, so
 * they pass while the bug is present and start failing the moment it is fixed —
 * at which point flip `it.fails` to `it` and delete the matching
 * characterization test above. See BUGS.md.
 */
describe("bug ledger", () => {
  // NOTE: BUG-17 as originally reported blamed cache.ts. That is not where it
  // lived — buildId iterates Object.entries and includes any key handed to it.
  // The defect was the call site in server.ts, which only ever passed width and
  // blur. The end-to-end ledger entry therefore lives in server.test.ts.

  it("BUG-17: id should distinguish blur radius, not just on/off", () => {
    const a = buildId(URL, { width: 100, blur: 5 });
    const b = buildId(URL, { width: 100, blur: 40 });

    expect(a).not.toBe(b);
  });

  it("BUG-16: cache evicts under pressure rather than growing forever", () => {
    setCacheMaxBytes(10_000);
    for (let i = 0; i < 5_000; i++) {
      toCache(`id-${i}`, { contentType: "image/jpeg", buffer: Buffer.alloc(64) });
    }

    expect(cacheSize()).toBeLessThan(5_000);
    expect(cacheBytes()).toBeLessThanOrEqual(10_000);
  });
});
