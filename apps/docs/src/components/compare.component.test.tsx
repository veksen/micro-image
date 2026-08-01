/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup, screen } from "@testing-library/react";
import Compare from "./compare.component";

const ORIGINAL = "https://example.com/cat.jpg";

function stubMetaFetch(body: unknown) {
  const fetchMock = vi.fn(async () => ({ json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders Compare wrapping a single img the effect will attach to. */
function renderCompare(originalSrc = ORIGINAL) {
  const result = render(
    <Compare originalSrc={originalSrc}>
      <img src="http://localhost:4000/cache?image=cat.jpg&width=300" alt="" />
    </Compare>
  );
  // the child img the effect targets is the first one in the container
  const target = () => result.container.querySelector("img") as HTMLImageElement;
  return { ...result, target };
}

const META = {
  original: { src: ORIGINAL, contentLength: 100_000 },
  processed: { src: "http://localhost:4000/cache?image=cat.jpg&width=300", contentLength: 25_000 },
};

describe("Compare — current behaviour", () => {
  it("shows loading until the meta request resolves", () => {
    stubMetaFetch(META);
    renderCompare();

    expect(screen.getAllByText("loading...")).toHaveLength(2);
  });

  it("renders both sizes once meta resolves", async () => {
    stubMetaFetch(META);
    const { target } = renderCompare();

    await act(async () => {
      target().onload?.(new Event("load") as never);
    });

    expect(screen.getByText("97.7 kB")).toBeDefined();
    expect(screen.getByText("24.4 kB")).toBeDefined();
  });

  it("reports the percentage saved", async () => {
    stubMetaFetch(META);
    const { target } = renderCompare();

    await act(async () => {
      target().onload?.(new Event("load") as never);
    });

    expect(screen.getByText("(75.0% smaller)")).toBeDefined();
  });

  it("stays on loading forever when content-length was absent", async () => {
    // /api/meta reports 0 for a missing content-length, and 0 is falsy here
    stubMetaFetch({
      original: { src: ORIGINAL, contentLength: 0 },
      processed: { src: "x", contentLength: 0 },
    });
    const { target } = renderCompare();

    await act(async () => {
      target().onload?.(new Event("load") as never);
    });

    expect(screen.getAllByText("loading...")).toHaveLength(2);
  });
});

describe("Compare — onload ownership [BUG-12]", () => {
  it("clobbers a handler already set on the img", async () => {
    stubMetaFetch(META);
    const previous = vi.fn();

    const { container } = render(
      <Compare originalSrc={ORIGINAL}>
        <img
          src="http://localhost:4000/cache?image=cat.jpg"
          alt=""
          ref={(el) => {
            if (el) el.onload = previous;
          }}
        />
      </Compare>
    );

    const img = container.querySelector("img") as HTMLImageElement;
    await act(async () => {
      img.onload?.(new Event("load") as never);
    });

    // the effect overwrote the ref's handler outright
    expect(previous).not.toHaveBeenCalled();
  });

  it("leaves the handler attached after unmount", () => {
    stubMetaFetch(META);
    const { target, unmount } = renderCompare();
    const img = target();

    unmount();

    // the effect returns no cleanup function
    expect(img.onload).not.toBeNull();
  });

  it("fires a stale handler when originalSrc changes before the image loads", async () => {
    const fetchMock = stubMetaFetch(META);
    const { target, rerender } = renderCompare();
    const img = target();

    rerender(
      <Compare originalSrc="https://example.com/dog.jpg">
        <img src="http://localhost:4000/cache?image=dog.jpg&width=300" alt="" />
      </Compare>
    );

    await act(async () => {
      img.onload?.(new Event("load") as never);
    });

    // only the newest handler survives, so the in-flight load for the previous
    // src resolves against the new one — one load, one request, wrong pairing
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(encodeURIComponent("dog.jpg"));
  });
});

describe("bug ledger", () => {
  it.fails("BUG-12: unmount should detach the load handler", () => {
    stubMetaFetch(META);
    const { target, unmount } = renderCompare();
    const img = target();

    unmount();

    expect(img.onload).toBeNull();
  });

  it.fails("BUG-12: the effect should attach with addEventListener, not assignment", async () => {
    stubMetaFetch(META);
    const previous = vi.fn();

    const { container } = render(
      <Compare originalSrc={ORIGINAL}>
        <img
          src="http://localhost:4000/cache?image=cat.jpg"
          alt=""
          ref={(el) => {
            if (el) el.onload = previous;
          }}
        />
      </Compare>
    );

    const img = container.querySelector("img") as HTMLImageElement;
    await act(async () => {
      img.onload?.(new Event("load") as never);
    });

    expect(previous).toHaveBeenCalled();
  });

  it.fails("BUG-13c: a zero content-length should render as unknown, not loading", async () => {
    stubMetaFetch({
      original: { src: ORIGINAL, contentLength: 0 },
      processed: { src: "x", contentLength: 0 },
    });
    const { target } = renderCompare();

    await act(async () => {
      target().onload?.(new Event("load") as never);
    });

    expect(screen.queryAllByText("loading...")).toHaveLength(0);
  });
});
