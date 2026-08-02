import { describe, it, expect } from "vitest";
import { generateUrl } from "./ipx";

const URL_BASE = "http://localhost:3000/_ipx";
const SRC = "https://example.com/photos/cat.jpg?v=1";
const SIMPLE_SRC = "https://example.com/cat.jpg";

describe("ipx generateUrl — current behaviour", () => {
  it("includes modifiers that were provided and omits the rest", () => {
    const url = generateUrl({ url: URL_BASE, src: SIMPLE_SRC, width: 300, quality: 75 });

    expect(url).toContain("width_300");
    expect(url).toContain("quality_75");
    expect(url).not.toContain("format_");
    expect(url).not.toContain("blur_");
  });

  it("passes the blur radius through, unlike the micro-image provider", () => {
    expect(generateUrl({ url: URL_BASE, src: SIMPLE_SRC, blur: 5 })).toContain("blur_5");
  });

  it("appends the encoded source url after the modifier segment", () => {
    expect(
      generateUrl({ url: URL_BASE, src: SIMPLE_SRC, width: 300 }).endsWith(
        encodeURIComponent(SIMPLE_SRC)
      )
    ).toBe(true);
  });

  it("emits the `_` no-op modifier segment when no transform was requested", () => {
    // ipx answers 400 IPX_MISSING_MODIFIERS on an empty first path segment.
    expect(generateUrl({ url: URL_BASE, src: SIMPLE_SRC })).toBe(
      `${URL_BASE}/_/${encodeURIComponent(SIMPLE_SRC)}`
    );
  });

  it("encodes modifier values, so a format string cannot inject a second modifier", () => {
    const url = generateUrl({ url: URL_BASE, src: SIMPLE_SRC, format: "webp,width_9000" });

    const [modifiers] = url.slice(`${URL_BASE}/`.length).split("/");

    expect(modifiers).toBe("format_webp%2Cwidth_9000");
    expect(modifiers?.split(",")).toHaveLength(1);
  });

  it("round-trips the source through ipx's decode of the id segment", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC, width: 300 });

    // ipx: [modifiers, ...idSegments] = path.split("/"); id = decode(idSegments.join("/"))
    const [, ...idSegments] = url.slice(`${URL_BASE}/`.length).split("/");
    expect(decodeURIComponent(idSegments.join("/"))).toBe(SRC);
  });
});

describe("bug ledger", () => {
  it("BUG-28: no image_ modifier should be emitted", () => {
    expect(generateUrl({ url: URL_BASE, src: SIMPLE_SRC, width: 300 })).not.toContain("image_");
  });

  it("BUG-28: modifiers should be only the requested transforms", () => {
    expect(generateUrl({ url: URL_BASE, src: SIMPLE_SRC, width: 300 })).toBe(
      `${URL_BASE}/width_300/${encodeURIComponent(SIMPLE_SRC)}`
    );
  });

  it("BUG-29: the source url should be encoded in the path segment", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC });

    expect(url.endsWith(encodeURIComponent(SRC))).toBe(true);
  });

  it("BUG-29: the source query string does not become the ipx request's own", () => {
    expect(new URL(generateUrl({ url: URL_BASE, src: SRC })).search).toBe("");
  });
});
