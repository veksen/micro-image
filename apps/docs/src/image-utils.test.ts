/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from "vitest";
import { getImageProportions } from "./image-utils";
import { FakeImage, installImageStub } from "./test-helpers";

const URL = "https://example.com/huge-photo.jpg";

beforeEach(() => {
  installImageStub();
});

describe("getImageProportions — current behaviour", () => {
  it("resolves with the intrinsic dimensions", async () => {
    const promise = getImageProportions(URL);
    FakeImage.instances[0]!.fireLoad(4000, 3000);

    await expect(promise).resolves.toEqual({ width: 4000, height: 3000 });
  });

  it("rejects when the image fails to load", async () => {
    const promise = getImageProportions(URL);
    FakeImage.instances[0]!.fireError();

    await expect(promise).rejects.toBeUndefined();
  });

  it("assigns the full-resolution url as the src [BUG-11]", () => {
    getImageProportions(URL);

    // the entire original is downloaded just to read two integers; there is no
    // size cap and no request to the proxy for a small variant
    expect(FakeImage.instances[0]!.src).toBe(URL);
  });

  it("does not set decoding to async [BUG-11]", () => {
    getImageProportions(URL);

    expect(FakeImage.instances[0]!.decoding).toBe("");
  });
});

describe("bug ledger", () => {
  it.fails("BUG-11: dimensions should be read from a size-capped variant", () => {
    getImageProportions(URL);

    expect(FakeImage.instances[0]!.src).not.toBe(URL);
  });

  it.fails("BUG-11: decoding should be async so the main thread is not blocked", () => {
    getImageProportions(URL);

    expect(FakeImage.instances[0]!.decoding).toBe("async");
  });

  it.fails("BUG-11b: rejection should carry an error explaining what failed", async () => {
    const promise = getImageProportions(URL);
    FakeImage.instances[0]!.fireError();

    await expect(promise).rejects.toBeInstanceOf(Error);
  });
});
