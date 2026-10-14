import { describe, it, expect } from "vitest";
import {
  capLadder,
  fitRatio,
  fixtures,
  ladder,
  median,
  parseImageFetch,
  proxyUrl,
  srcSet,
} from "./model";

const PROXY = "http://localhost:4100/cache";
const SRC = "http://127.0.0.1:3100/bench/large-3.jpg";

describe("capLadder", () => {
  it("keeps the whole ladder for a source wider than its top rung", () => {
    expect(capLadder(5272)).toEqual([...ladder, 5272]);
  });

  it("ends at the intrinsic width, never past it", () => {
    expect(capLadder(800)).toEqual([32, 48, 64, 96, 128, 256, 384, 640, 750, 800]);
  });

  it("does not repeat a rung the source matches exactly", () => {
    expect(capLadder(640).at(-2)).toBe(384);
    expect(capLadder(640).at(-1)).toBe(640);
  });
});

describe("srcSet", () => {
  it("offers one proxy url per capped rung", () => {
    const candidates = srcSet(PROXY, SRC, fixtures.small).split(", ");

    expect(candidates).toHaveLength(capLadder(800).length);
    expect(candidates.at(-1)).toBe(`${proxyUrl(PROXY, SRC, 800)} 800w`);
  });
});

describe("parseImageFetch", () => {
  it("reads the image and width back out of a proxy url", () => {
    expect(parseImageFetch(proxyUrl(PROXY, SRC, 828))).toEqual({
      index: 3,
      width: 828,
      placeholder: false,
    });
  });

  it("reads a next/image url", () => {
    const url = "http://127.0.0.1:3100/_next/image?url=%2Fbench%2Fsmall-0.jpg&w=1920&q=75";

    expect(parseImageFetch(url)).toEqual({ index: 0, width: 1920, placeholder: false });
  });

  it("marks the shipped component's blurred stand-in as a placeholder", () => {
    const url = `${PROXY}?image=${encodeURIComponent(SRC)}&width=500&quality=75&blur=5`;

    expect(parseImageFetch(url)?.placeholder).toBe(true);
  });

  it("ignores requests that are not for a fixture", () => {
    expect(parseImageFetch("http://127.0.0.1:3100/_next/static/chunks/main.js")).toBeUndefined();
    expect(
      parseImageFetch(`${PROXY}?image=${encodeURIComponent("http://x/cat.jpg")}`)
    ).toBeUndefined();
  });
});

describe("fitRatio", () => {
  it("is 1 when the delivered width matches the box", () => {
    expect(fitRatio(1920, 5272, 1920)).toBe(1);
  });

  it("counts a fetch past the source as the source, since that is what arrives", () => {
    expect(fitRatio(1920, 800, 1920)).toBeCloseTo(800 / 1920);
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
