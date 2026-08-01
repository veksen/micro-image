import sharp from "sharp";

/**
 * Photo-like image fixtures for the benchmark.
 *
 * The test suite's `makeJpeg`/`makePng` helpers draw a smooth linear gradient,
 * which is fine for asserting behaviour but useless for measuring compression:
 * a smooth gradient is close to the best case PNG will ever see, and lanczos
 * resampling destroys the long identical runs it depends on. A 800x600 gradient
 * PNG resized to 400w actually comes out LARGER than the original (105,980 ->
 * 106,523 bytes), which would make the proxy look broken when it is not.
 *
 * This generator sums sinusoids at several frequencies, adds a hard-edged
 * object and fine grain, so its frequency content resembles a photograph.
 * Resizing it saves 74-99% depending on format and quality, which is the range
 * real images land in.
 *
 * No Math.random: fixtures must be byte-identical between runs, or the
 * benchmark measures noise.
 */
function photoPixels(width: number, height: number) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const u = x / width;
      const v = y / height;

      // low-frequency lighting, mid-frequency structure, high-frequency detail
      let r =
        110 +
        70 * Math.sin(6.0 * u + 1.1) +
        45 * Math.sin(17.0 * v + 0.4) +
        25 * Math.sin(41.0 * (u + v));
      let g =
        100 +
        60 * Math.sin(5.0 * v + 2.2) +
        40 * Math.sin(23.0 * u + 1.7) +
        20 * Math.sin(37.0 * (u - v));
      let b =
        95 +
        55 * Math.sin(7.0 * (u + 0.3 * v)) +
        35 * Math.sin(29.0 * v + 0.9) +
        18 * Math.sin(53.0 * u);

      // repeating structure, the kind of thing entropy coders latch onto
      if (((x * 13 + y * 7) >> 5) % 11 === 0) {
        r += 28;
        g -= 18;
        b += 12;
      }

      // a hard-edged object, so there is at least one sharp discontinuity
      if (x > width * 0.62 && x < width * 0.74 && y > height * 0.2 && y < height * 0.8) {
        r = 210;
        g = 190;
        b = 60;
      }

      const grain = ((x * 7919 + y * 104729) % 17) - 8;
      data[i] = Math.max(0, Math.min(255, r + grain));
      data[i + 1] = Math.max(0, Math.min(255, g + grain));
      data[i + 2] = Math.max(0, Math.min(255, b + grain));
    }
  }

  return { data, width, height, channels: channels as 3 };
}

export interface PhotoOptions {
  width?: number;
  height?: number;
  quality?: number;
}

export function photoJpeg({ width = 1600, height = 1200, quality = 80 }: PhotoOptions = {}) {
  const { data, ...raw } = photoPixels(width, height);
  return sharp(data, { raw: { ...raw, channels: 3 } })
    .jpeg({ quality })
    .toBuffer();
}

export function photoPng({ width = 800, height = 600 }: PhotoOptions = {}) {
  const { data, ...raw } = photoPixels(width, height);
  return sharp(data, { raw: { ...raw, channels: 3 } })
    .png()
    .toBuffer();
}

export function photoWebp({ width = 800, height = 600, quality = 80 }: PhotoOptions = {}) {
  const { data, ...raw } = photoPixels(width, height);
  return sharp(data, { raw: { ...raw, channels: 3 } })
    .webp({ quality })
    .toBuffer();
}
