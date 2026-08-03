/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import Image from "./image.component";
import { FakeImage, FakeResizeObserver, installDomStubs } from "./test-helpers";

const SRC = "https://example.com/cat.jpg";
const PROXY = "http://localhost:4000/cache";

beforeEach(() => {
  installDomStubs();
});

afterEach(() => {
  cleanup();
});

function renderImage(props: Partial<React.ComponentProps<typeof Image>> = {}) {
  const result = render(<Image src={SRC} width={800} height={600} alt="a cat" {...props} />);
  return { ...result, img: () => result.container.querySelector("img") };
}

/** Flush the requestAnimationFrame the resize callback defers to. */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

describe("Image — rendering", () => {
  it("renders an img with the alt text", () => {
    const { img } = renderImage();

    expect(img()).not.toBeNull();
    expect(img()!.getAttribute("alt")).toBe("a cat");
  });

  it("renders an empty alt when none is given", () => {
    const { img } = renderImage({ alt: undefined });

    expect(img()!.getAttribute("alt")).toBe("");
  });

  it("sets the aspect ratio custom property from width and height", () => {
    const { container } = renderImage({ width: 800, height: 400 });
    const wrapper = container.firstElementChild as HTMLElement;

    expect(wrapper.style.getPropertyValue("--ratio")).toBe("2");
  });

  it("defaults objectFit to none", () => {
    const { img } = renderImage();

    expect(img()!.style.objectFit).toBe("none");
  });

  it("honours an explicit objectFit", () => {
    const { img } = renderImage({ objectFit: "cover" });

    expect(img()!.style.objectFit).toBe("cover");
  });

  it("observes the img element for resizes", () => {
    const { img } = renderImage();

    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]!.observed[0]).toBe(img());
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = renderImage();

    unmount();

    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
  });
});

describe("Image — initial paint has no srcset [BUG-10]", () => {
  it("renders the blurred 500px placeholder as the only src", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("src")).toBe(
      `${PROXY}?image=${encodeURIComponent(SRC)}&width=500&blur=5`
    );
  });

  it("ships no srcset and no sizes attribute on first paint", () => {
    const { img } = renderImage();

    // the preload scanner sees only the placeholder; the real variant cannot
    // start until React mounts and the ResizeObserver fires
    expect(img()!.getAttribute("srcset")).toBeNull();
    expect(img()!.getAttribute("sizes")).toBeNull();
  });

  it("only sets srcset and sizes after a resize is observed", async () => {
    const { img } = renderImage();

    act(() => FakeResizeObserver.instances[0]!.resizeTo(640));
    await flushFrame();

    expect(img()!.sizes).toBe("700px");
    expect(img()!.srcset).toContain("100w");
  });

  it("rounds the observed width up to the next 100px bucket", async () => {
    const { img } = renderImage();

    act(() => FakeResizeObserver.instances[0]!.resizeTo(601));
    await flushFrame();

    expect(img()!.sizes).toBe("700px");
  });

  it("generates 19 srcset candidates from 100w to 1900w", async () => {
    const { img } = renderImage();

    act(() => FakeResizeObserver.instances[0]!.resizeTo(640));
    await flushFrame();

    const candidates = img()!.srcset.split(", ");
    expect(candidates).toHaveLength(19);
    expect(candidates[0]).toContain(" 100w");
    expect(candidates[18]).toContain(" 1900w");
  });

  it("puts the requested width into each srcset candidate url", async () => {
    const { img } = renderImage();

    act(() => FakeResizeObserver.instances[0]!.resizeTo(640));
    await flushFrame();

    expect(img()!.srcset).toContain("width=100&quality=75");
  });
});

describe("Image — failure", () => {
  it("removes the img when the rendered element itself fails", () => {
    const { img } = renderImage();
    expect(img()).not.toBeNull();

    act(() => fireEvent.error(img()!));

    expect(img()).toBeNull();
  });

  it("tries again when the caller points at a different src", () => {
    const { img, rerender } = renderImage();

    act(() => fireEvent.error(img()!));
    expect(img()).toBeNull();

    rerender(<Image src="https://example.com/dog.jpg" width={800} height={600} alt="a dog" />);

    // a boolean would have latched here and rendered nothing forever
    expect(img()).not.toBeNull();
  });

  it("observes the remounted element, not the one it replaced", async () => {
    const { img, rerender } = renderImage();

    act(() => fireEvent.error(img()!));
    rerender(<Image src="https://example.com/dog.jpg" width={800} height={600} alt="a dog" />);

    const observer = FakeResizeObserver.instances.at(-1)!;
    expect(observer.observed[0]).toBe(img());

    act(() => observer.resizeTo(640));
    await flushFrame();
    expect(img()!.sizes).toBe("700px");
  });
});

describe("bug ledger", () => {
  it.fails("BUG-10: first paint should carry a srcset for the preload scanner", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("srcset")).not.toBeNull();
  });

  it.fails("BUG-10: first paint should carry a sizes attribute", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("sizes")).not.toBeNull();
  });

  it("BUG-1: no image should be fetched whose bytes are discarded", () => {
    const { img } = renderImage();

    // nothing constructs `new Image()` any more, so there is no fetch outside
    // the element; the invariant below still holds if one is ever added back
    expect(FakeImage.instances).toHaveLength(0);

    const rendered = new Set(
      [
        img()!.getAttribute("src"),
        ...img()!
          .srcset.split(", ")
          .map((c) => c.split(" ")[0]),
      ].filter(Boolean)
    );

    for (const instance of FakeImage.instances) {
      expect(rendered.has(instance.src)).toBe(true);
    }
  });

  it("BUG-2: the placeholder should request the blur radius the component passes", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("src")).toContain("blur=5");
  });
});
