/** jsdom never loads images, so tests drive a controllable stand-in. */
export class FakeImage {
  static instances: FakeImage[] = [];

  static reset() {
    FakeImage.instances = [];
  }

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 0;
  height = 0;
  decoding = "";
  src = "";

  constructor() {
    FakeImage.instances.push(this);
  }

  /** Simulate a successful load reporting the given intrinsic size. */
  fireLoad(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.onload?.();
  }

  fireError() {
    this.onerror?.();
  }
}

export function installImageStub() {
  FakeImage.reset();
  globalThis.Image = FakeImage as unknown as typeof Image;
}
