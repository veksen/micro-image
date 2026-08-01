/**
 * jsdom does not load images or implement ResizeObserver, so both are stubbed
 * with controllable fakes. Every instance is recorded, which is what lets the
 * tests observe requests the component makes but never uses.
 */

export class FakeImage {
  static instances: FakeImage[] = [];

  static reset() {
    FakeImage.instances = [];
  }

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  /** Listeners registered via addEventListener, as opposed to the props above. */
  listeners: Record<string, Array<() => void>> = {};

  private _src = "";

  constructor() {
    FakeImage.instances.push(this);
  }

  get src() {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
  }

  addEventListener(type: string, handler: () => void) {
    (this.listeners[type] ||= []).push(handler);
  }

  removeEventListener(type: string, handler: () => void) {
    this.listeners[type] = (this.listeners[type] || []).filter((h) => h !== handler);
  }

  /** Simulate a successful network load. */
  fireLoad() {
    this.onload?.();
    (this.listeners.load || []).forEach((h) => h());
  }

  /** Simulate a failed network load. */
  fireError() {
    this.onerror?.();
    (this.listeners.error || []).forEach((h) => h());
  }
}

export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  static reset() {
    FakeResizeObserver.instances = [];
  }

  observed: Element[] = [];
  disconnected = false;

  constructor(private callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.observed.push(target);
  }

  unobserve(target: Element) {
    this.observed = this.observed.filter((t) => t !== target);
  }

  disconnect() {
    this.disconnected = true;
  }

  /** Drive the callback as if the element had been resized to `width`. */
  resizeTo(width: number) {
    this.callback(
      [{ contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
}

export function installDomStubs() {
  FakeImage.reset();
  FakeResizeObserver.reset();
  globalThis.Image = FakeImage as unknown as typeof Image;
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
}
