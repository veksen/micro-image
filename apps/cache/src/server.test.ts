import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  buildServer,
  parseCacheOptions,
  legacyBlurRadius,
  resolveResponseMime,
  fallbackMime,
} from "./server";
import { clearCache } from "./cache";
import { makeGif, makeJpeg, makePng, startOrigin, type Origin } from "./test-helpers";

let app: FastifyInstance;
let origin: Origin | undefined;

beforeEach(() => {
  clearCache();
  app = buildServer({ logger: false });
});

afterEach(async () => {
  await app.close();
  await origin?.close();
  origin = undefined;
});

/** Requests /cache for a path served by the local origin. */
function get(query: Record<string, string>) {
  return app.inject({ method: "GET", url: "/cache", query });
}

/**
 * The query string is parsed once and handed to both the cache key and the
 * transform. Their disagreement was the actual defect behind BUG-17, so the
 * parser is worth testing directly rather than only through the route.
 */
describe("parseCacheOptions", () => {
  const IMAGE = "https://example.com/cat.jpg";

  it("returns nothing for a request that asks for nothing", () => {
    expect(parseCacheOptions({ image: IMAGE })).toEqual({
      width: undefined,
      quality: undefined,
      format: undefined,
      blur: undefined,
    });
  });

  it("parses the options a client actually sends", () => {
    expect(
      parseCacheOptions({ image: IMAGE, width: "200", quality: "30", format: "webp" })
    ).toEqual({ width: 200, quality: 30, format: "webp", blur: undefined });
  });

  it("maps the legacy blur boolean onto the radius the proxy has always applied", () => {
    expect(parseCacheOptions({ image: IMAGE, blur: "true" }).blur).toBe(legacyBlurRadius);
    expect(parseCacheOptions({ image: IMAGE, blur: "false" }).blur).toBeUndefined();
  });

  it("keeps a numeric blur radius", () => {
    expect(parseCacheOptions({ image: IMAGE, blur: "5" }).blur).toBe(5);
  });

  it("treats unusable numbers as absent so they cannot mint their own cache entry", () => {
    // `?width=` is Number("") === 0, and `?width=abc` is NaN. Neither resizes
    // anything, so neither may key differently from omitting width entirely.
    for (const width of ["", "abc", "0", "-5"]) {
      expect(parseCacheOptions({ image: IMAGE, width }).width, `width=${width}`).toBeUndefined();
    }
  });

  it("treats an empty format as absent", () => {
    expect(parseCacheOptions({ image: IMAGE, format: "" }).format).toBeUndefined();
  });
});

describe("resolveResponseMime", () => {
  it("relays a well-formed image type", () => {
    expect(resolveResponseMime("image/jpeg")).toBe("image/jpeg");
    expect(resolveResponseMime("image/svg+xml")).toBe("image/svg+xml");
    expect(resolveResponseMime("image/avif")).toBe("image/avif");
  });

  it("drops parameters, which are meaningless on an image", () => {
    expect(resolveResponseMime("image/jpeg; charset=binary")).toBe("image/jpeg");
  });

  it("normalises case and surrounding whitespace", () => {
    expect(resolveResponseMime("  IMAGE/JPEG  ")).toBe("image/jpeg");
  });

  it("refuses a missing type rather than emitting undefined", () => {
    expect(resolveResponseMime(undefined)).toBe(fallbackMime);
    expect(resolveResponseMime("")).toBe(fallbackMime);
  });

  it("refuses anything that is not an image type", () => {
    expect(resolveResponseMime("text/html; charset=utf-8")).toBe(fallbackMime);
    expect(resolveResponseMime("application/javascript")).toBe(fallbackMime);
    expect(resolveResponseMime("not a mime at all")).toBe(fallbackMime);
    expect(resolveResponseMime("image/")).toBe(fallbackMime);
  });

  it("refuses a type carrying a header injection attempt", () => {
    expect(resolveResponseMime("image/jpeg\r\nX-Injected: 1")).toBe(fallbackMime);
  });
});

describe("GET / — health", () => {
  it("returns the hello payload", async () => {
    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hello: "world" });
  });
});

describe("GET /cache — happy path", () => {
  it("compresses a jpeg and returns fewer bytes than the origin", async () => {
    // quality 80 avoids the BUG-18 false-positive band, so this exercises the
    // path where compression actually runs
    const jpeg = await makeJpeg({ width: 800, height: 600, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const res = await get({ image: `${origin.url}/cat.jpg`, width: "200" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
    expect(res.rawPayload.byteLength).toBeLessThan(jpeg.byteLength);
  });

  it("resizes down to the requested width", async () => {
    const jpeg = await makeJpeg({ width: 800, height: 600, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const res = await get({ image: `${origin.url}/cat.jpg`, width: "200" });
    const sharp = (await import("sharp")).default;

    expect((await sharp(res.rawPayload).metadata()).width).toBe(200);
  });

  it("does not enlarge beyond the source width", async () => {
    const jpeg = await makeJpeg({ width: 100, height: 100, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const res = await get({ image: `${origin.url}/cat.jpg`, width: "900" });
    const sharp = (await import("sharp")).default;

    expect((await sharp(res.rawPayload).metadata()).width).toBe(100);
  });

  it("keeps the original when compression would make it bigger", async () => {
    const png = await makePng({ width: 40, height: 40, content: "flat" });
    origin = await startOrigin({ "/flat.png": { body: png, contentType: "image/png" } });

    const res = await get({ image: `${origin.url}/flat.png` });

    expect(res.rawPayload.byteLength).toBeLessThanOrEqual(png.byteLength);
  });

  it("serves the second request for the same key from memory", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    await get({ image: `${origin.url}/cat.jpg`, width: "200" });
    await get({ image: `${origin.url}/cat.jpg`, width: "200" });

    expect(origin.hits["/cat.jpg"]).toBe(1);
  });

  it("treats a different width as a different cache key", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    await get({ image: `${origin.url}/cat.jpg`, width: "200" });
    await get({ image: `${origin.url}/cat.jpg`, width: "300" });

    expect(origin.hits["/cat.jpg"]).toBe(2);
  });

  it("returns an animated gif untouched", async () => {
    const gif = makeGif({ delay: 10 });
    origin = await startOrigin({ "/anim.gif": { body: gif, contentType: "image/gif" } });

    const res = await get({ image: `${origin.url}/anim.gif`, width: "100" });

    expect(Buffer.compare(res.rawPayload, gif)).toBe(0);
  });
});

describe("GET /cache — transform parameters [BUG-3, BUG-4, BUG-2]", () => {
  it("keys on ?quality= and applies it", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const a = await get({ image: `${origin.url}/cat.jpg`, width: "200", quality: "30" });
    const b = await get({ image: `${origin.url}/cat.jpg`, width: "200", quality: "90" });

    expect(origin.hits["/cat.jpg"]).toBe(2);
    expect(Buffer.compare(a.rawPayload, b.rawPayload)).not.toBe(0);
  });

  it("distinguishes blur radii rather than reading a flag", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const five = await get({ image: `${origin.url}/cat.jpg`, width: "200", blur: "5" });
    const forty = await get({ image: `${origin.url}/cat.jpg`, width: "200", blur: "40" });

    expect(Buffer.compare(five.rawPayload, forty.rawPayload)).not.toBe(0);
  });

  it("still honours the legacy blur=true the published client sends", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const legacy = await get({ image: `${origin.url}/cat.jpg`, width: "200", blur: "true" });
    const explicit = await get({ image: `${origin.url}/cat.jpg`, width: "200", blur: "10" });

    // blur=true has always meant radius 10, so it must keep meaning that
    expect(Buffer.compare(legacy.rawPayload, explicit.rawPayload)).toBe(0);
  });

  it("rejects a format it cannot encode, before fetching anything", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const res = await get({ image: `${origin.url}/cat.jpg`, format: "bmp" });

    expect(res.statusCode).toBe(400);
    expect(origin.hits["/cat.jpg"]).toBeUndefined();
  });

  it("treats format=original as an explicit request for the source format", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const res = await get({ image: `${origin.url}/cat.jpg`, width: "200", format: "original" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/jpeg");
  });

  it("serves a converted image from cache with the converted mime", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    await get({ image: `${origin.url}/cat.jpg`, width: "200", format: "webp" });
    const hit = await get({ image: `${origin.url}/cat.jpg`, width: "200", format: "webp" });

    // the cache record stores the output mime, not the upstream one, or the
    // second caller gets webp bytes labelled image/jpeg
    expect(origin.hits["/cat.jpg"]).toBe(1);
    expect(hit.headers["content-type"]).toContain("image/webp");
  });

  it("does not fall back to the smaller original when a format was requested", async () => {
    // a tiny flat png converts to a webp that is larger than the source, which
    // is exactly when getSmallestImage would have handed back png bytes
    const png = await makePng({ width: 40, height: 40, content: "flat" });
    origin = await startOrigin({ "/flat.png": { body: png, contentType: "image/png" } });

    const res = await get({ image: `${origin.url}/flat.png`, format: "webp" });
    const sharp = (await import("sharp")).default;

    expect(res.headers["content-type"]).toContain("image/webp");
    expect((await sharp(res.rawPayload).metadata()).format).toBe("webp");
  });
});

describe("GET /cache — animated-gif handling, end to end [BUG-18]", () => {
  it("processes a quality-100 jpeg rather than short-circuiting on it", async () => {
    const jpeg = await makeJpeg({ width: 800, height: 600, quality: 100 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const res = await get({ image: `${origin.url}/cat.jpg`, width: "100" });

    // previously isAnimatedGif said yes, and the route returned the full
    // original uncompressed under a cache key claiming it was 100px wide
    expect(Buffer.compare(res.rawPayload, jpeg)).not.toBe(0);
  });

  it("still returns a real animated gif untouched", async () => {
    const gif = makeGif({ delay: 10 });
    origin = await startOrigin({ "/loop.gif": { body: gif, contentType: "image/gif" } });

    const res = await get({ image: `${origin.url}/loop.gif`, width: "2" });

    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.rawPayload, gif)).toBe(0);
  });
});

/**
 * Undecodable bytes that reach sharp.
 *
 * Before BUG-18 was fixed, the choice of bytes mattered here: an ASCII string
 * like "not an image at all" was swallowed by the animated-gif false positive
 * (byte 13 lands on 'a', 0x61, which shares a bit with the 0x21 mask) and handed
 * straight back with a 200, never reaching sharp. Only an all-zero buffer got
 * through. Now that the probe is gif-only and matches by equality, any
 * undecodable payload reaches sharp.
 */
const UNDECODABLE = Buffer.alloc(64);

describe("GET /cache — error handling [BUG-26]", () => {
  it("returns a 500 when sharp cannot decode the payload", async () => {
    origin = await startOrigin({
      "/broken.png": { body: UNDECODABLE, contentType: "image/png" },
    });

    const res = await get({ image: `${origin.url}/broken.png`, width: "100" });

    // no try/catch and no fallback to the original bytes
    expect(res.statusCode).toBe(500);
  });

  it("no longer masks undecodable ascii payloads as animated gifs [BUG-18]", async () => {
    origin = await startOrigin({
      "/broken.png": { body: Buffer.from("not an image at all"), contentType: "image/png" },
    });

    const res = await get({ image: `${origin.url}/broken.png`, width: "100" });

    // it used to come back 200 with the garbage intact. It now reaches sharp,
    // which fails — the 500 is BUG-26, tracked separately
    expect(res.statusCode).toBe(500);
    expect(res.rawPayload.toString()).not.toBe("not an image at all");
  });

  it("returns a 500 when the origin is unreachable", async () => {
    const res = await get({ image: "http://127.0.0.1:1/nope.jpg" });

    expect(res.statusCode).toBe(500);
  });
});

describe("GET /cache — SSRF [BUG-25]", () => {
  it("fetches an arbitrary loopback address with no allowlist", async () => {
    const secret = "INTERNAL-ONLY-PAYLOAD";
    origin = await startOrigin({
      "/internal": { body: secret, contentType: "text/plain" },
    });

    const res = await get({ image: `${origin.url}/internal` });

    // ?image= accepts any URL; loopback and link-local are reachable
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toContain(secret);
  });
});

describe("GET /cache — no upstream limits [BUG-24]", () => {
  it("waits on a slow origin with no timeout of its own", async () => {
    const jpeg = await makeJpeg({ width: 100, height: 100, quality: 80 });
    origin = await startOrigin({
      "/slow.jpg": { body: jpeg, contentType: "image/jpeg", delayMs: 1_500 },
    });

    const startedAt = Date.now();
    const res = await get({ image: `${origin.url}/slow.jpg` });

    // axios is configured with no `timeout`, so a slow origin holds the worker
    // for as long as it likes
    expect(res.statusCode).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_400);
  });
});

describe("GET /cache — byte fidelity [BUG-19]", () => {
  it("does not corrupt bytes despite the 'binary' encoding argument", async () => {
    // Buffer.from(buffer, "binary") ignores the encoding when the input is
    // already a Buffer, so this is a needless full copy rather than corruption.
    // The wasted copy is measured in the benchmark, not asserted here.
    const gif = makeGif({ delay: 10 });
    origin = await startOrigin({ "/anim.gif": { body: gif, contentType: "image/gif" } });

    const res = await get({ image: `${origin.url}/anim.gif` });

    expect(Buffer.compare(res.rawPayload, gif)).toBe(0);
  });
});

/**
 * BUG LEDGER — desired behaviour, currently failing.
 * Flip `it.fails` to `it` as each bug is fixed. See BUGS.md.
 */
describe("bug ledger", () => {
  it("BUG-15: cache hits carry the same Cache-Control as misses", async () => {
    const jpeg = await makeJpeg({ width: 200, height: 200, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    await get({ image: `${origin.url}/cat.jpg`, width: "100" });
    const hit = await get({ image: `${origin.url}/cat.jpg`, width: "100" });

    expect(hit.headers["cache-control"]).toContain("max-age=2592000");
  });

  it("BUG-21: unsupported mimes are cached too", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
    origin = await startOrigin({ "/i.svg": { body: svg, contentType: "image/svg+xml" } });

    await get({ image: `${origin.url}/i.svg` });
    await get({ image: `${origin.url}/i.svg` });

    expect(origin.hits["/i.svg"]).toBe(1);
  });

  it("BUG-17: quality should be part of the cache key", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    await get({ image: `${origin.url}/cat.jpg`, width: "200", quality: "30" });
    await get({ image: `${origin.url}/cat.jpg`, width: "200", quality: "90" });

    expect(origin.hits["/cat.jpg"]).toBe(2);
  });

  it("BUG-3: ?quality= should change the output bytes", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const low = await get({ image: `${origin.url}/cat.jpg`, width: "200", quality: "20" });
    clearCache();
    const high = await get({ image: `${origin.url}/cat.jpg`, width: "200", quality: "95" });

    expect(low.rawPayload.byteLength).toBeLessThan(high.rawPayload.byteLength);
  });

  it("BUG-4: ?format=webp should return a webp", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const res = await get({ image: `${origin.url}/cat.jpg`, width: "200", format: "webp" });

    expect(res.headers["content-type"]).toContain("image/webp");
  });

  it("BUG-18: a quality-100 jpeg should still be resized and compressed", async () => {
    const jpeg = await makeJpeg({ width: 800, height: 600, quality: 100 });
    origin = await startOrigin({ "/cat.jpg": { body: jpeg, contentType: "image/jpeg" } });

    const res = await get({ image: `${origin.url}/cat.jpg`, width: "100" });
    const sharp = (await import("sharp")).default;

    expect((await sharp(res.rawPayload).metadata()).width).toBe(100);
  });

  it("BUG-22: a non-image upstream content-type is not relayed", async () => {
    const jpeg = await makeJpeg({ width: 100, height: 100, quality: 80 });
    origin = await startOrigin({
      "/cat.jpg": { body: jpeg, contentType: "text/html; charset=utf-8" },
    });

    const res = await get({ image: `${origin.url}/cat.jpg` });

    expect(res.headers["content-type"]).not.toContain("text/html");
  });

  it.fails("BUG-26: an undecodable payload should fall back, not 500", async () => {
    origin = await startOrigin({
      "/broken.png": { body: UNDECODABLE, contentType: "image/png" },
    });

    const res = await get({ image: `${origin.url}/broken.png`, width: "100" });

    expect(res.statusCode).toBe(200);
  });

  it.fails("BUG-25: loopback and link-local targets should be refused", async () => {
    origin = await startOrigin({ "/internal": { body: "secret", contentType: "text/plain" } });

    const res = await get({ image: `${origin.url}/internal` });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it.fails("BUG-24: a slow origin should be cut off by a request timeout", async () => {
    const jpeg = await makeJpeg({ width: 100, height: 100, quality: 80 });
    origin = await startOrigin({
      "/slow.jpg": { body: jpeg, contentType: "image/jpeg", delayMs: 1_500 },
    });

    const res = await get({ image: `${origin.url}/slow.jpg` });

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
  });

  it("BUG-23: concurrent cold requests coalesce to one fetch", async () => {
    const jpeg = await makeJpeg({ width: 400, height: 300, quality: 80 });
    origin = await startOrigin({
      "/cat.jpg": { body: jpeg, contentType: "image/jpeg", delayMs: 50 },
    });

    await Promise.all(
      Array.from({ length: 8 }, () => get({ image: `${origin!.url}/cat.jpg`, width: "200" }))
    );

    expect(origin.hits["/cat.jpg"]).toBe(1);
  });
});
