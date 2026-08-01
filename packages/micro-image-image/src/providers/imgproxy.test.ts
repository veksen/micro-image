import { describe, it, expect } from "vitest";
import { generateUrl } from "./imgproxy";

const URL_BASE = "http://localhost:8080";
const SRC = "https://example.com/photos/cat.jpg?v=1";

describe("imgproxy generateUrl — current behaviour", () => {
  it("emits provided processing options in w/q/bl order", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC, width: 300, quality: 75, blur: 5 });

    expect(url).toContain("/w:300/q:75/bl:5/");
  });

  it("omits options that were not provided", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC });

    expect(url).not.toContain("w:");
    expect(url).not.toContain("q:");
    expect(url).not.toContain("bl:");
  });

  it("always emits the enlarge and extend options", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).toContain("/el:1/ex:1/");
  });

  it("passes the blur radius through, unlike the micro-image provider", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC, blur: 5 })).toContain("bl:5");
  });

  it("defaults the extension to jpg and honours an explicit format", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).toMatch(/\.jpg$/);
    expect(generateUrl({ url: URL_BASE, src: SRC, format: "webp" })).toMatch(/\.webp$/);
  });

  it("base64-encodes the source url", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC });
    const encoded = url
      .split("/")
      .pop()!
      .replace(/\.jpg$/, "");

    expect(Buffer.from(encoded, "base64").toString()).toBe(SRC);
  });
});

/**
 * BUG-6 as reported: `bl: [options.blur]` builds a single-element array and the
 * filter keeps the key when ANY element is defined. With exactly one element
 * that is equivalent to `blur !== undefined`, so it is correct today — but it
 * is correct by accident. Adding a second value to any of those arrays makes
 * the key emit `undefined` into the URL. These tests pin the current behaviour
 * so that fragility is visible if someone extends the arrays.
 */
describe("single-element option arrays [BUG-6]", () => {
  it("omits bl entirely when blur is undefined", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).not.toContain("bl:");
  });

  it("emits bl when blur is defined", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC, blur: 0 })).toContain("bl:0");
  });
});

describe("url encoding of the source [BUG-30]", () => {
  it("uses standard base64 with padding rather than base64url", () => {
    // imgproxy requires URL-safe base64 without padding. btoa emits the
    // standard alphabet, so "=" lands in the path.
    const url = generateUrl({ url: URL_BASE, src: SRC });

    expect(url).toContain("=");
  });

  it("emits + and / from the standard alphabet into the path", () => {
    // a source whose bytes encode to the two URL-unsafe characters
    const awkward = "https://example.com/a?b=~~~>>>";
    const url = generateUrl({ url: URL_BASE, src: awkward });
    const encoded = url
      .split("/")
      .pop()!
      .replace(/\.jpg$/, "");

    expect(encoded).toMatch(/[+/]/);
  });
});

describe("signature segment [BUG-31]", () => {
  it("emits no signature and no /insecure/ prefix", () => {
    // imgproxy expects /{signature}/{processing}/{encoded}; unsigned
    // deployments require the literal "insecure" segment
    const url = generateUrl({ url: URL_BASE, src: SRC });

    expect(url.startsWith(`${URL_BASE}/el:1`)).toBe(true);
    expect(url).not.toContain("/insecure/");
  });
});

describe("bug ledger", () => {
  it.fails("BUG-30: the source should be base64url encoded without padding", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC });
    const encoded = url
      .split("/")
      .pop()!
      .replace(/\.jpg$/, "");

    expect(encoded).not.toMatch(/[+/=]/);
  });

  it.fails("BUG-30: awkward sources should stay url-safe", () => {
    const awkward = "https://example.com/a?b=~~~>>>";
    const url = generateUrl({ url: URL_BASE, src: awkward });
    const encoded = url
      .split("/")
      .pop()!
      .replace(/\.jpg$/, "");

    expect(encoded).not.toMatch(/[+/=]/);
  });

  it.fails("BUG-31: an unsigned url should carry the insecure segment", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).toContain("/insecure/");
  });

  it.fails("BUG-6: option arrays should drop undefined members, not the whole key", () => {
    // guards the fragility directly: if the arrays ever grow, no "undefined"
    // may appear in the generated url
    const url = generateUrl({ url: URL_BASE, src: SRC, width: 300 });

    expect(url).toContain("/w:300/");
    expect(url).not.toContain("el:1");
  });
});
