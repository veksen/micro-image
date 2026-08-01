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

  it("appends the source url after the modifier segment", () => {
    expect(generateUrl({ url: URL_BASE, src: SIMPLE_SRC, width: 300 }).endsWith(SIMPLE_SRC)).toBe(
      true
    );
  });

  it("emits a bogus image_ modifier containing the whole encoded source [BUG-28]", () => {
    // ipx modifiers are transforms (w_, h_, q_, f_). There is no `image_`
    // modifier; ipx takes the source from the path segment after the
    // modifiers, which this generator also emits. The source is sent twice.
    const url = generateUrl({ url: URL_BASE, src: SIMPLE_SRC, width: 300 });

    expect(url).toBe(`${URL_BASE}/image_${encodeURIComponent(SIMPLE_SRC)},width_300/${SIMPLE_SRC}`);
  });

  it("appends the source url unencoded, leaking its query string [BUG-29]", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC });

    // "?v=1" stays live in the final url, so ipx sees v=1 as its own query
    // param rather than as part of the source address
    expect(url.endsWith("/https://example.com/photos/cat.jpg?v=1")).toBe(true);
    expect(url.indexOf("?")).toBeLessThan(url.length - 1);
  });
});

describe("bug ledger", () => {
  it.fails("BUG-28: no image_ modifier should be emitted", () => {
    expect(generateUrl({ url: URL_BASE, src: SIMPLE_SRC, width: 300 })).not.toContain("image_");
  });

  it.fails("BUG-28: modifiers should be only the requested transforms", () => {
    expect(generateUrl({ url: URL_BASE, src: SIMPLE_SRC, width: 300 })).toBe(
      `${URL_BASE}/width_300/${encodeURIComponent(SIMPLE_SRC)}`
    );
  });

  it.fails("BUG-29: the source url should be encoded in the path segment", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC });

    expect(url.endsWith(encodeURIComponent(SRC))).toBe(true);
  });
});
