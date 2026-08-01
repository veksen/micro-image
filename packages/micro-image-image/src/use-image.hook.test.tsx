/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import useImage from "./use-image.hook";
import { FakeImage, installDomStubs } from "./test-helpers";

beforeEach(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

const SRC = "http://localhost:4000/cache?image=cat.jpg";

describe("useImage — current behaviour", () => {
  it("starts fetching as soon as a src is given", () => {
    const { result } = renderHook(() => useImage(SRC));

    expect(result.current.fetching).toBe(true);
    expect(result.current.loaded).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it("does nothing without a src", () => {
    const { result } = renderHook(() => useImage(undefined));

    expect(FakeImage.instances).toHaveLength(0);
    expect(result.current.fetching).toBe(false);
  });

  it("requests exactly the src it was given", () => {
    renderHook(() => useImage(SRC));

    expect(FakeImage.instances).toHaveLength(1);
    expect(FakeImage.instances[0]!.src).toBe(SRC);
  });

  it("reports loaded after a successful load", () => {
    const { result } = renderHook(() => useImage(SRC));

    act(() => FakeImage.instances[0]!.fireLoad());

    expect(result.current.loaded).toBe(true);
    expect(result.current.fetching).toBe(false);
    expect(result.current.error).toBe(false);
  });

  it("reports error after a failed load", () => {
    const { result } = renderHook(() => useImage(SRC));

    act(() => FakeImage.instances[0]!.fireError());

    expect(result.current.error).toBe(true);
    expect(result.current.fetching).toBe(false);
    expect(result.current.loaded).toBe(false);
  });

  it("starts a fresh request when the src changes", () => {
    const { rerender } = renderHook(({ src }) => useImage(src), {
      initialProps: { src: SRC },
    });

    rerender({ src: `${SRC}&width=300` });

    expect(FakeImage.instances).toHaveLength(2);
    expect(FakeImage.instances[1]!.src).toBe(`${SRC}&width=300`);
  });

  it("resets state when the src changes", () => {
    const { result, rerender } = renderHook(({ src }) => useImage(src), {
      initialProps: { src: SRC },
    });

    act(() => FakeImage.instances[0]!.fireLoad());
    expect(result.current.loaded).toBe(true);

    rerender({ src: `${SRC}&width=300` });

    expect(result.current.loaded).toBe(false);
    expect(result.current.fetching).toBe(true);
  });
});

describe("cleanup is a no-op [BUG-8]", () => {
  it("leaves the onload/onerror props attached after unmount", () => {
    const { unmount } = renderHook(() => useImage(SRC));
    const image = FakeImage.instances[0]!;

    unmount();

    // the hook assigns image.onerror / image.onload as properties but detaches
    // with removeEventListener, which only ever touches addEventListener
    // registrations — so both handlers survive the cleanup
    expect(image.onload).not.toBeNull();
    expect(image.onerror).not.toBeNull();
  });

  it("never registered anything with addEventListener in the first place", () => {
    renderHook(() => useImage(SRC));

    expect(FakeImage.instances[0]!.listeners).toEqual({});
  });
});

describe("bug ledger", () => {
  it.fails("BUG-8: unmount should detach the load and error handlers", () => {
    const { unmount } = renderHook(() => useImage(SRC));
    const image = FakeImage.instances[0]!;

    unmount();

    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
  });
});
