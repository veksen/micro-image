import { describe, it, expect, beforeEach } from "vitest";
import { buildId, fromCache, toCache, clearCache, cacheSize } from "./cache";

const URL = "https://example.com/cat.jpg";

beforeEach(() => {
  clearCache();
});

describe("buildId — current behaviour", () => {
  it("appends width and omits blur when blur is false", () => {
    expect(buildId(URL, { width: 100, blur: false })).toBe(`${URL}__width-100`);
  });

  it("appends blur only when it is exactly true", () => {
    expect(buildId(URL, { width: 100, blur: true })).toBe(`${URL}__width-100__blur-true`);
  });

  it("serialises a missing width as the literal string 'width-NaN'", () => {
    // the route always passes Number(request.query.width), so an absent
    // ?width= reaches buildId as NaN rather than undefined
    expect(buildId(URL, { width: Number(undefined), blur: false })).toBe(`${URL}__width-NaN`);
  });

  it("treats an empty ?width= as width-0, not as absent", () => {
    // Number("") is 0 while Number(undefined) is NaN, so `?width=` and no
    // width at all land on two different cache keys
    expect(buildId(URL, { width: Number(""), blur: false })).toBe(`${URL}__width-0`);
    expect(buildId(URL, { width: Number(undefined), blur: false })).toBe(`${URL}__width-NaN`);
  });

  it("is generic over whatever keys the caller passes", () => {
    // buildId itself iterates Object.entries, so it would happily include
    // quality/format. The omission is at the call site in server.ts, not here.
    expect(buildId(URL, { width: 100, blur: false, quality: 30 } as never)).toBe(
      `${URL}__width-100__quality-30`
    );
  });

  it("distinguishes different widths", () => {
    expect(buildId(URL, { width: 100, blur: false })).not.toBe(
      buildId(URL, { width: 200, blur: false })
    );
  });

  it("distinguishes different source urls", () => {
    expect(buildId(URL, { width: 100, blur: false })).not.toBe(
      buildId("https://example.com/dog.jpg", { width: 100, blur: false })
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

  it("grows without bound — no cap, no TTL, no eviction [BUG-16]", () => {
    for (let i = 0; i < 5_000; i++) {
      toCache(`id-${i}`, { contentType: "image/jpeg", buffer: Buffer.alloc(64) });
    }

    // every distinct ?width= value an attacker sends becomes a permanent entry
    expect(cacheSize()).toBe(5_000);
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
  // lives — buildId iterates Object.entries and would include any key handed to
  // it (see the "generic over whatever keys" test above). The defect is the
  // call site in server.ts, which only ever passes width and blur. The ledger
  // entry for it therefore lives in server.test.ts.

  it.fails("BUG-17: id should distinguish blur radius, not just on/off", () => {
    const a = buildId(URL, { width: 100, blur: 5 } as never);
    const b = buildId(URL, { width: 100, blur: 40 } as never);

    expect(a).not.toBe(b);
  });

  it.fails("BUG-16: cache should evict under pressure rather than grow forever", () => {
    for (let i = 0; i < 5_000; i++) {
      toCache(`id-${i}`, { contentType: "image/jpeg", buffer: Buffer.alloc(64) });
    }

    expect(cacheSize()).toBeLessThan(5_000);
  });
});
