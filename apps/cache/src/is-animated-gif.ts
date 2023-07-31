function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const bytes = new Uint8Array(arrayBuffer);
  for (let i = 0; i < buffer.length; ++i) {
    bytes[i] = buffer[i];
  }
  return arrayBuffer;
}

export function isAnimatedGif(imageBuffer: Buffer): boolean {
  const arrayBuffer = toArrayBuffer(imageBuffer);

  const HEADER_LEN = 6; // offset bytes for the header section
  const LOGICAL_SCREEN_DESC_LEN = 7; // offset bytes for logical screen description section

  // Start from last 4 bytes of the Logical Screen Descriptor
  const dv = new DataView(arrayBuffer, HEADER_LEN + LOGICAL_SCREEN_DESC_LEN - 3);
  let offset = 0;
  const globalColorTable = dv.getUint8(0); // aka packet byte
  let globalColorTableSize = 0;

  // check first bit, if 0, then we don't have a Global Color Table
  if (globalColorTable & 0x80) {
    // grab the last 3 bits, to calculate the global color table size -> RGB * 2^(N+1)
    // N is the value in the last 3 bits.
    globalColorTableSize = 3 * 2 ** ((globalColorTable & 0x7) + 1);
  }

  // move on to the Graphics Control Extension
  offset = 3 + globalColorTableSize;

  const extensionIntroducer = dv.getUint8(offset);
  const graphicsConrolLabel = dv.getUint8(offset + 1);
  let delayTime = 0;

  // Graphics Control Extension section is where GIF animation data is stored
  // First 2 bytes must be 0x21 and 0xF9
  if (extensionIntroducer & 0x21 && graphicsConrolLabel & 0xf9) {
    // skip to the 2 bytes with the delay time
    delayTime = dv.getUint16(offset + 4);
  }

  return delayTime > 0;
}
