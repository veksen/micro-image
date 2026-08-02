import { describe, it, expect } from "vitest";
import { generateUrl, processingOption } from "./imgproxy";

const URL_BASE = "http://localhost:8080";
const SRC = "https://example.com/photos/cat.jpg?v=1";

const encodedSegment = (url: string) =>
  url
    .split("/")
    .pop()!
    .replace(/\.[a-z0-9]+$/, "");

const decode = (encoded: string) => Buffer.from(encoded, "base64url").toString("utf8");

describe("imgproxy generateUrl", () => {
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

  it("leaves no empty segment when no option was provided", () => {
    // an empty segment would leave "//" in the path, which imgproxy reads as an
    // empty processing option rather than as no options at all
    expect(generateUrl({ url: URL_BASE, src: SRC })).toBe(
      `${URL_BASE}/insecure/aHR0cHM6Ly9leGFtcGxlLmNvbS9waG90b3MvY2F0LmpwZz92PTE.jpg`
    );
  });

  it("passes the blur radius through, unlike the micro-image provider", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC, blur: 5 })).toContain("bl:5");
  });

  it("defaults the extension to jpg and honours an explicit format", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).toMatch(/\.jpg$/);
    expect(generateUrl({ url: URL_BASE, src: SRC, format: "webp" })).toMatch(/\.webp$/);
  });
});

describe("option arrays [BUG-6]", () => {
  it("omits bl entirely when blur is undefined", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).not.toContain("bl:");
  });

  it("emits bl when blur is defined", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC, blur: 0 })).toContain("bl:0");
  });

  it("BUG-6: option arrays should drop undefined members, not the whole key", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC, width: 300 });

    expect(url).toContain("/w:300/");
    expect(url).not.toContain("el:1");
  });

  it("joins every argument of a multi-argument option", () => {
    expect(processingOption("rs", "fill", 400, 300)).toBe("rs:fill:400:300");
  });

  it("truncates a multi-argument option at the first missing argument", () => {
    // arguments are positional: emitting rs:400 would read 400 as the resizing
    // type, so the option stops instead of promoting later arguments
    expect(processingOption("rs", "fill", undefined, 300)).toBe("rs:fill");
    expect(processingOption("rs", undefined, 400, 300)).toBeUndefined();
  });

  it("never emits the string undefined, whichever options are missing", () => {
    const cases = [
      { url: URL_BASE, src: SRC },
      { url: URL_BASE, src: SRC, width: 300 },
      { url: URL_BASE, src: SRC, quality: 75 },
      { url: URL_BASE, src: SRC, blur: 5 },
      { url: URL_BASE, src: SRC, width: 300, blur: 5 },
    ];

    for (const options of cases) {
      expect(generateUrl(options)).not.toContain("undefined");
    }
  });
});

describe("url encoding of the source [BUG-30]", () => {
  it("BUG-30: the source should be base64url encoded without padding", () => {
    expect(encodedSegment(generateUrl({ url: URL_BASE, src: SRC }))).not.toMatch(/[+/=]/);
  });

  it("BUG-30: awkward sources should stay url-safe", () => {
    // this source encodes to the two URL-unsafe characters under the standard alphabet
    const awkward = "https://example.com/a?b=~~~>>>";

    expect(encodedSegment(generateUrl({ url: URL_BASE, src: awkward }))).not.toMatch(/[+/=]/);
  });

  it("round-trips a source carrying a query string", () => {
    expect(decode(encodedSegment(generateUrl({ url: URL_BASE, src: SRC })))).toBe(SRC);
  });

  it("escapes a non-ascii source rather than corrupting it or throwing", () => {
    // btoa alone throws on code points above 255, and imgproxy's http client
    // refuses a decoded source that still carries raw non-ascii
    const unicode = "https://example.com/photos/chât-très-joli.jpg?légende=oui&emoji=🐈";
    const decoded = decode(encodedSegment(generateUrl({ url: URL_BASE, src: unicode })));

    expect(decoded).toMatch(/^[\x20-\x7e]+$/);
    expect(decodeURIComponent(decoded)).toBe(unicode);
  });

  it("escapes a control character, which imgproxy refuses raw", () => {
    const withNewline = "https://example.com/photos/cat\n.jpg";

    expect(decode(encodedSegment(generateUrl({ url: URL_BASE, src: withNewline })))).toBe(
      "https://example.com/photos/cat%0A.jpg"
    );
  });

  it("leaves printable ascii alone, including characters a stricter escape would encode", () => {
    // a stock imgproxy accepts all of these raw; escaping them would only make
    // the urls longer, and escaping % would double-escape an escaped source
    const printable = "https://example.com/a b.jpg?q=<x>|{y}&r=a^b`c";

    expect(decode(encodedSegment(generateUrl({ url: URL_BASE, src: printable })))).toBe(printable);
  });

  it("does not escape an already-escaped source twice", () => {
    const escaped = "https://example.com/photos/ch%C3%A2t.jpg?a=1&b=2";

    expect(decode(encodedSegment(generateUrl({ url: URL_BASE, src: escaped })))).toBe(escaped);
  });
});

describe("signature segment [BUG-31]", () => {
  it("BUG-31: an unsigned url should carry the insecure segment", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).toContain("/insecure/");
  });

  it("puts insecure in the signature position, ahead of the processing options", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC, width: 300 });

    expect(url.startsWith(`${URL_BASE}/insecure/w:300/`)).toBe(true);
  });
});
