import { describe, it, expect } from "vitest";
import { generateUrl } from "./micro-image";

const URL_BASE = "http://localhost:4000/cache";
const SRC = "https://example.com/photos/cat.jpg?v=1";

describe("micro-image generateUrl — current behaviour", () => {
  it("encodes the source url into the image param", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).toContain(`image=${encodeURIComponent(SRC)}`);
  });

  it("includes width, quality and format when provided", () => {
    const url = generateUrl({
      url: URL_BASE,
      src: SRC,
      width: 300,
      quality: 75,
      format: "webp",
    });

    expect(url).toContain("width=300");
    expect(url).toContain("quality=75");
    expect(url).toContain("format=webp");
  });

  it("omits width, quality and format when they are undefined", () => {
    const url = generateUrl({ url: URL_BASE, src: SRC });

    expect(url).not.toContain("width=");
    expect(url).not.toContain("quality=");
    expect(url).not.toContain("format=");
  });

  it("emits blur=false on every url that does not ask for blur [BUG-5]", () => {
    // Boolean(undefined) is false, not undefined, so blur always survives the
    // `!== undefined` filter and every generated url carries it
    expect(generateUrl({ url: URL_BASE, src: SRC })).toBe(
      `${URL_BASE}?image=${encodeURIComponent(SRC)}&blur=false`
    );
  });

  it("collapses a numeric blur radius to the string 'true' [BUG-2]", () => {
    const five = generateUrl({ url: URL_BASE, src: SRC, blur: 5 });
    const forty = generateUrl({ url: URL_BASE, src: SRC, blur: 40 });

    expect(five).toContain("blur=true");
    // the radius is gone before the request is even made
    expect(five).toBe(forty);
  });

  it("produces a stable url for identical options", () => {
    const a = generateUrl({ url: URL_BASE, src: SRC, width: 300 });
    const b = generateUrl({ url: URL_BASE, src: SRC, width: 300 });

    expect(a).toBe(b);
  });
});

describe("bug ledger", () => {
  it.fails("BUG-5: blur should be absent from the url when not requested", () => {
    expect(generateUrl({ url: URL_BASE, src: SRC })).not.toContain("blur");
  });

  it.fails("BUG-2: the blur radius should survive into the url", () => {
    const five = generateUrl({ url: URL_BASE, src: SRC, blur: 5 });
    const forty = generateUrl({ url: URL_BASE, src: SRC, blur: 40 });

    expect(five).not.toBe(forty);
    expect(five).toContain("blur=5");
  });
});
