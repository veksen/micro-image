import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

/**
 * What the `?micro` loader knows about one source file.
 *
 * This is `ImageMeta` from `VISION.md` minus `srcset` and `sizes`. A `srcset`
 * names variant URLs, and those depend on the provider and proxy URL the
 * component is configured with, which the build does not see. The proxy's
 * `?meta` endpoint leaves `srcset` out for the same reason.
 */
export interface SourceMeta {
  /** Intrinsic pixel width, read from the header the same way the proxy reads it. */
  width: number;
  /** Intrinsic pixel height. */
  height: number;
  /** An inline `data:image/webp;base64,…` LQIP. ADR 0002 proposes a data URI as the default. */
  placeholder: string;
}

/** Width of the LQIP in pixels. Its height follows the source's aspect ratio. */
const placeholderWidth = 16;
const placeholderQuality = 50;

/**
 * One entry per path, checked against a hash of the bytes, so an edited file
 * replaces its entry instead of adding one. Lives as long as the build or dev
 * server does; a disk cache is later work.
 */
const cache = new Map<string, { hash: string; meta: Promise<SourceMeta> }>();

export async function readSourceMeta(file: string): Promise<SourceMeta> {
  const bytes = await readFile(file);
  const hash = createHash("sha256").update(bytes).digest("hex");

  const cached = cache.get(file);
  if (cached?.hash === hash) return cached.meta;

  const meta = computeSourceMeta(bytes, file);
  cache.set(file, { hash, meta });
  // A failed read must not stay cached, or fixing the file would not fix the build.
  meta.catch(() => {
    if (cache.get(file)?.meta === meta) cache.delete(file);
  });
  return meta;
}

async function computeSourceMeta(bytes: Buffer, file: string): Promise<SourceMeta> {
  // No `.rotate()`: the proxy does not apply EXIF orientation, so neither does
  // this. Both paths have to report the same box for the same file.
  const { width, height } = await sharp(bytes).metadata();
  if (!width || !height) {
    throw new Error(`micro-image: sharp could not read the dimensions of ${file}`);
  }

  // WebP rather than JPEG: it keeps the alpha channel, which JPEG would
  // flatten onto black for a transparent PNG.
  const lqip = await sharp(bytes)
    .resize({ width: placeholderWidth })
    .webp({ quality: placeholderQuality })
    .toBuffer();

  return {
    width,
    height,
    placeholder: `data:image/webp;base64,${lqip.toString("base64")}`,
  };
}
