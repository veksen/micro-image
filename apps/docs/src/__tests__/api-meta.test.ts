import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import handler from "../pages/api/meta";

interface Recorded {
  status?: number;
  body?: unknown;
  ended: boolean;
}

function makeRes() {
  const recorded: Recorded = { ended: false };
  const res = {
    status(code: number) {
      recorded.status = code;
      return res;
    },
    json(body: unknown) {
      recorded.body = body;
      recorded.ended = true;
      return res;
    },
    end() {
      recorded.ended = true;
      return res;
    },
  };
  return { res: res as unknown as NextApiResponse, recorded };
}

function makeReq(method: string, query: Record<string, string> = {}): NextApiRequest {
  return { method, query } as unknown as NextApiRequest;
}

/** Stubs fetch so each url reports the given content-length (null = absent). */
function stubFetch(lengths: Record<string, string | null>) {
  const fetchMock = vi.fn(async (url: string) => ({
    headers: { get: (name: string) => (name === "content-length" ? (lengths[url] ?? null) : null) },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ORIGINAL = "https://example.com/cat.jpg";
const PROCESSED = "http://localhost:4000/cache?image=cat.jpg&width=300";

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/api/meta — happy path", () => {
  it("returns both content lengths", async () => {
    stubFetch({ [ORIGINAL]: "100000", [PROCESSED]: "25000" });
    const { res, recorded } = makeRes();

    await handler(makeReq("GET", { originalSrc: ORIGINAL, currentSrc: PROCESSED }), res);

    expect(recorded.status).toBe(200);
    expect(recorded.body).toEqual({
      original: { src: ORIGINAL, contentLength: 100000 },
      processed: { src: PROCESSED, contentLength: 25000 },
    });
  });

  it("fetches both urls in parallel", async () => {
    const fetchMock = stubFetch({ [ORIGINAL]: "100000", [PROCESSED]: "25000" });
    const { res } = makeRes();

    await handler(makeReq("GET", { originalSrc: ORIGINAL, currentSrc: PROCESSED }), res);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * BUG-13 as reported claimed a missing content-length yields NaN. It does not:
 * Headers.get returns null when the header is absent, and Number(null) is 0.
 * The user-visible symptom is different and arguably worse — Compare treats 0
 * as falsy and sits on "loading..." forever. NaN only appears when the header
 * is present but not numeric.
 */
describe("/api/meta — missing or malformed content-length [BUG-13]", () => {
  it("reports 0, not NaN, when the header is absent", async () => {
    stubFetch({ [ORIGINAL]: null, [PROCESSED]: null });
    const { res, recorded } = makeRes();

    await handler(makeReq("GET", { originalSrc: ORIGINAL, currentSrc: PROCESSED }), res);

    const body = recorded.body as { original: { contentLength: number } };
    expect(body.original.contentLength).toBe(0);
    expect(Number.isNaN(body.original.contentLength)).toBe(false);
  });

  it("reports NaN when the header is present but not a number", async () => {
    stubFetch({ [ORIGINAL]: "chunked", [PROCESSED]: "25000" });
    const { res, recorded } = makeRes();

    await handler(makeReq("GET", { originalSrc: ORIGINAL, currentSrc: PROCESSED }), res);

    const body = recorded.body as { original: { contentLength: number } };
    expect(Number.isNaN(body.original.contentLength)).toBe(true);
  });

  it("still answers 200 with an unusable payload rather than erroring", async () => {
    stubFetch({ [ORIGINAL]: null, [PROCESSED]: null });
    const { res, recorded } = makeRes();

    await handler(makeReq("GET", { originalSrc: ORIGINAL, currentSrc: PROCESSED }), res);

    expect(recorded.status).toBe(200);
  });
});

describe("/api/meta — non-GET methods [BUG-14]", () => {
  it("never responds to a POST", async () => {
    stubFetch({});
    const { res, recorded } = makeRes();

    await handler(makeReq("POST", { originalSrc: ORIGINAL, currentSrc: PROCESSED }), res);

    // no status, no body, no end() — the request hangs until the client or
    // platform times it out
    expect(recorded.status).toBeUndefined();
    expect(recorded.ended).toBe(false);
  });

  it("never responds to a HEAD or DELETE either", async () => {
    stubFetch({});

    for (const method of ["HEAD", "DELETE", "PUT", "PATCH"]) {
      const { res, recorded } = makeRes();
      await handler(makeReq(method, {}), res);
      expect(recorded.ended, `${method} should have responded`).toBe(false);
    }
  });
});

describe("bug ledger", () => {
  it.fails("BUG-14: a non-GET method should get a 405", async () => {
    stubFetch({});
    const { res, recorded } = makeRes();

    await handler(makeReq("POST", {}), res);

    expect(recorded.status).toBe(405);
  });

  it.fails("BUG-13: an absent content-length should be reported as unknown", async () => {
    stubFetch({ [ORIGINAL]: null, [PROCESSED]: null });
    const { res, recorded } = makeRes();

    await handler(makeReq("GET", { originalSrc: ORIGINAL, currentSrc: PROCESSED }), res);

    const body = recorded.body as { original: { contentLength: number | null } };
    expect(body.original.contentLength).toBeNull();
  });

  it.fails("BUG-13b: a missing query param should be rejected, not fetched", async () => {
    const fetchMock = stubFetch({});
    const { res } = makeRes();

    await handler(makeReq("GET", {}), res);

    // today it calls fetch("undefined") and lets it throw
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
