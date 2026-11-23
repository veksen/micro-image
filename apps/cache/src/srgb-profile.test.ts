import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { probe } from "./is-animated";
import { compress } from "./server";
import { hasNoOpProfile } from "./srgb-profile";

/** A busy 640x480 image, so a colour conversion would have pixels to move. */
function noisy(): sharp.Sharp {
  const width = 640;
  const height = 480;
  const data = Buffer.alloc(width * height * 3);

  for (let i = 0; i < data.length; i++) {
    data[i] = (i * 7919 + (i >> 9) * 104729) % 256;
  }

  return sharp(data, { raw: { width, height, channels: 3 } });
}

describe("hasNoOpProfile", () => {
  it("accepts libvips' built-in sRGB profile", async () => {
    const tagged = await noisy().withIccProfile("srgb").jpeg().toBuffer();
    expect(hasNoOpProfile(await sharp(tagged).metadata())).toBe(true);
  });

  it("rejects a profile whose conversion moves pixels", async () => {
    const p3 = await noisy().withIccProfile("p3").jpeg().toBuffer();
    expect(hasNoOpProfile(await sharp(p3).metadata())).toBe(false);
  });

  it("rejects an image with no profile", async () => {
    const bare = await noisy().jpeg().toBuffer();
    expect(hasNoOpProfile(await sharp(bare).metadata())).toBe(false);
  });

  it("rejects a 16-bit image even with an sRGB profile", async () => {
    const deep = await noisy().toColourspace("rgb16").withIccProfile("srgb").png().toBuffer();
    expect(hasNoOpProfile(await sharp(deep).metadata())).toBe(false);
  });
});

describe("skipping a no-op profile conversion", () => {
  it.each(["image/jpeg", "image/webp", "image/png"])(
    "leaves %s output byte-identical",
    async (mime) => {
      const tagged = await noisy().withIccProfile("srgb").jpeg({ quality: 90 }).toBuffer();
      expect((await probe(tagged)).noOpProfile).toBe(true);

      const converted = await compress(tagged, { contentType: mime, width: 320 });
      const skipped = await compress(tagged, { contentType: mime, width: 320, noOpProfile: true });

      expect(skipped.equals(converted)).toBe(true);
    }
  );
});
