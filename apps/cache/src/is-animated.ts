/**
 * Does this image carry more than one frame?
 *
 * The question is asked of the decoder, not of the bytes. libvips reports
 * `pages` from a **default** load — it needs the header, not a full decode — and
 * it covers GIF, WebP and TIFF alike. That matters because the proxy's real job
 * here is to notice animation before `resize()` silently throws every frame but
 * the first away, and `resize()` is a libvips operation. Asking libvips what it
 * is holding cannot disagree with what libvips will then do to it.
 *
 * This replaces a hand-written GIF container parser that produced two bugs in
 * opposite directions. It read `0x21 0xF9` at a computed offset and treated a
 * match as animation: BUG-18 was a false positive on JPEGs, whose byte 10 is a
 * quantization-table entry set by encoder quality, and #52 was a false negative
 * on every looping GIF, which puts a NETSCAPE 2.0 Application Extension
 * (`0x21 0xFF`) at exactly that offset. No offset is read here.
 *
 * Formats libvips has no multi-page support for report no page count at all —
 * APNG among them, which is why an APNG still reaches the transform and is still
 * flattened. That is a known gap, not something this module can close: libvips
 * has no APNG code in either direction.
 */

import sharp from "sharp";

/**
 * How many frames the image holds — or `null` when nothing can decode it.
 *
 * `null` and `1` are deliberately distinct. A still image genuinely has one
 * frame; a payload no decoder accepts has no answer, and the caller should not
 * be told it has one. Exported so the count stays observable: a boolean cannot
 * distinguish a correct count from a wrong one, which is what let the retired
 * parser's endianness bug hide.
 */
export async function frameCount(buffer: Buffer): Promise<number | null> {
  try {
    const { pages } = await sharp(buffer).metadata();

    // `pages` is absent for formats that cannot hold more than one frame, and
    // for a still WebP. Decodable at all means at least one frame.
    return pages ?? 1;
  } catch {
    // Undecodable. Callers treat this as "not animated" and let the transform
    // fail on its own terms, which keeps the error surface in one place.
    return null;
  }
}

export async function isAnimated(buffer: Buffer): Promise<boolean> {
  const frames = await frameCount(buffer);

  return frames !== null && frames > 1;
}
