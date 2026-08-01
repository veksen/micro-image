/**
 * Minimal GIF container parsing — just enough to answer "does this animate?".
 *
 * Only the bytes leading up to the first Graphics Control Extension matter:
 *
 *   0                   6                    13           13 + gctSize
 *   +-------------------+--------------------+------------+-------------------+
 *   | Header (6)        | Logical Screen     | Global     | Graphics Control  |
 *   | "GIF87a"/"GIF89a" | Descriptor (7)     | Color Tbl  | Extension (8)     |
 *   +-------------------+--------------------+------------+-------------------+
 *
 * The Graphics Control Extension is introduced by the byte pair 0x21 0xF9 and
 * carries the frame delay at its offset 4, little-endian.
 */

const GIF_SIGNATURES = ["GIF87a", "GIF89a"];

const HEADER_LEN = 6;
const LOGICAL_SCREEN_DESC_LEN = 7;
const GCE_LEN = 8;

/** Every GIF extension block opens with this byte. */
const EXTENSION_INTRODUCER = 0x21;
/** Label identifying an extension block as a Graphics Control Extension. */
const GRAPHICS_CONTROL_LABEL = 0xf9;
/** Offset of the delay time within the Graphics Control Extension. */
const DELAY_TIME_OFFSET = 4;

/** Packed-field bits in the Logical Screen Descriptor. */
const GLOBAL_COLOR_TABLE_FLAG = 0x80;
const COLOR_TABLE_SIZE_MASK = 0x07;

function hasGifSignature(buffer: Buffer): boolean {
  if (buffer.length < HEADER_LEN) {
    return false;
  }

  return GIF_SIGNATURES.includes(buffer.toString("ascii", 0, HEADER_LEN));
}

/**
 * The first frame's delay, in hundredths of a second — or `null` when the buffer
 * is not a GIF, is truncated, or carries no Graphics Control Extension.
 *
 * Exported so the little-endian decode stays observable: `isAnimatedGif`
 * collapses this to a boolean, and a boolean cannot distinguish a byte-swapped
 * read from a correct one.
 */
export function gifDelayTime(buffer: Buffer): number | null {
  if (!hasGifSignature(buffer)) {
    return null;
  }

  const packedFieldOffset = HEADER_LEN + 4;
  if (packedFieldOffset >= buffer.length) {
    return null;
  }

  const packedField = buffer.readUInt8(packedFieldOffset);

  // Global Color Table size is 3 * 2^(N+1) bytes, N being the low 3 bits.
  const globalColorTableSize =
    packedField & GLOBAL_COLOR_TABLE_FLAG
      ? 3 * 2 ** ((packedField & COLOR_TABLE_SIZE_MASK) + 1)
      : 0;

  const gceOffset = HEADER_LEN + LOGICAL_SCREEN_DESC_LEN + globalColorTableSize;
  if (gceOffset + GCE_LEN > buffer.length) {
    return null;
  }

  // Matched by equality. A bitwise AND passes on any byte sharing a single bit
  // with the mask, which is how ordinary JPEGs came to be read as animated GIFs
  // — byte 10 of a JPEG is a quantization-table entry set by encoder quality.
  if (
    buffer.readUInt8(gceOffset) !== EXTENSION_INTRODUCER ||
    buffer.readUInt8(gceOffset + 1) !== GRAPHICS_CONTROL_LABEL
  ) {
    return null;
  }

  // Little-endian, per the GIF spec.
  return buffer.readUInt16LE(gceOffset + DELAY_TIME_OFFSET);
}

export function isAnimatedGif(imageBuffer: Buffer): boolean {
  const delayTime = gifDelayTime(imageBuffer);

  return delayTime !== null && delayTime > 0;
}
