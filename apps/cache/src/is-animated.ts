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
 * Formats libvips has no multi-page support for report no page count at all.
 * APNG is the only one that matters, because it is the only one that is both
 * animated and routinely labelled as something the proxy transforms: an APNG is
 * a PNG, arrives as `image/png`, and libvips has no APNG code in either
 * direction. For that one format the container is read directly — see
 * `apngFrameCount` — because there is no decoder to ask.
 *
 * That is a narrow exception, not a return to the retired approach. The walk
 * follows each chunk's own length prefix; it never reads a computed offset, and
 * it never searches for bytes that could occur inside pixel data.
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
  let metadata;

  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    // Undecodable. Callers treat this as "not animated" and let the transform
    // fail on its own terms, which keeps the error surface in one place.
    return null;
  }

  // libvips populates `pages` on a default load for every format it can page.
  if (metadata.pages !== undefined) {
    return metadata.pages;
  }

  // PNG is the exception, and the reason is absence rather than disagreement:
  // libvips has no APNG code, so it reports no page count at all for a
  // 12-frame file. Deferring to the decoder here would answer 1 and let
  // `resize()` discard 11 frames. The container is the only signal there is.
  if (metadata.format === "png") {
    const declared = apngFrameCount(buffer);

    if (declared !== null) {
      return declared;
    }
  }

  // `pages` is absent for formats that cannot hold more than one frame, and
  // for a still WebP. Decodable at all means at least one frame.
  return 1;
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Length (4) plus type (4) plus CRC (4): the overhead every PNG chunk carries. */
const chunkOverhead = 12;

/** Where a chunk's data starts, measured from the chunk's own offset. */
const chunkDataOffset = 8;

/** `acTL` is `num_frames` (4) then `num_plays` (4) — PNG 3rd ed §11.3.6.1. */
const actlLength = 8;

/**
 * Frames declared by an `acTL` chunk, or `null` when there is no animation.
 *
 * PNG Third Edition §11.3.6.1: *"The acTL chunk must appear before the first
 * IDAT chunk within a valid PNG stream."* So the walk stops at `IDAT` — an
 * `acTL` after it does not animate the file, and treating one as if it did
 * would pass through images that should have been transformed.
 *
 * Chunks are walked by their length prefix rather than scanned for. A search
 * for the bytes `acTL` would match them anywhere, including inside compressed
 * pixel data, which is the class of mistake that produced BUG-18.
 */
function apngFrameCount(buffer: Buffer): number | null {
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    return null;
  }

  let offset = pngSignature.length;

  // every chunk is length(4) type(4) data(length) crc(4)
  while (offset + chunkDataOffset <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + chunkDataOffset);

    if (type === "IDAT") {
      return null;
    }

    if (type === "acTL") {
      // Trust the chunk's own length before reading its data, the way every
      // other step of this walk does. A truncated or zero-length acTL would
      // otherwise yield whatever four bytes happen to follow — its CRC, or the
      // next chunk's length prefix — as a frame count.
      const complete = length >= actlLength && offset + chunkOverhead + length <= buffer.length;

      // num_frames is the first field of the chunk's data
      return complete ? buffer.readUInt32BE(offset + chunkDataOffset) : null;
    }

    // A corrupt length cannot hang this: the offset climbs by at least the
    // overhead each pass, so an overrun ends the walk rather than repeating it.
    offset += chunkOverhead + length;
  }

  return null;
}

export async function isAnimated(buffer: Buffer): Promise<boolean> {
  const frames = await frameCount(buffer);

  return frames !== null && frames > 1;
}
