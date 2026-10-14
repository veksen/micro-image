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

  it("does not measure the element: sizes comes from the markup alone", () => {
    renderImage();

    expect(FakeResizeObserver.instances).toHaveLength(0);
  });
});

describe("Image — first paint", () => {
  it("keeps the blurred placeholder as the src for browsers without srcset", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("src")).toBe(
      `${PROXY}?image=${encodeURIComponent(SRC)}&width=500&blur=5`
    );
  });

  const widths = (srcset: string) => srcset.split(", ").map((c) => c.split(" ")[1]);

  it("caps the srcset at the intrinsic width", () => {
    const { img } = renderImage({ width: 800 });

    // a DPR 2 display asked for 1200, 1600 and 1900w of an 800px source
    expect(widths(img()!.srcset)).toEqual([
      "100w",
      "200w",
      "300w",
      "400w",
      "500w",
      "600w",
      "700w",
      "800w",
    ]);
  });

  it("ends the srcset on an intrinsic width between steps", () => {
    const { img } = renderImage({ width: 850 });

    expect(widths(img()!.srcset).slice(-2)).toEqual(["800w", "850w"]);
  });

  it("offers only the source width for a source narrower than one step", () => {
    const { img } = renderImage({ width: 64 });

    expect(widths(img()!.srcset)).toEqual(["64w"]);
  });

  it("still stops the srcset at 1900w for a wider source", () => {
    const { img } = renderImage({ width: 4000 });

    const candidates = widths(img()!.srcset);
    expect(candidates).toHaveLength(19);
    expect(candidates.at(-1)).toBe("1900w");
  });

  it("puts the requested width into each srcset candidate url", () => {
    const { img } = renderImage();

    expect(img()!.srcset).toContain("width=100&quality=75");
  });

  it("loads lazily by default and lets the browser size it with auto", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("loading")).toBe("lazy");
    expect(img()!.getAttribute("sizes")).toBe("auto, (max-width: 800px) 100vw, 800px");
  });

  it("keeps the same sizes when loading eagerly, where the browser skips auto", () => {
    const { img } = renderImage({ loading: "eager" });

    expect(img()!.getAttribute("loading")).toBe("eager");
    expect(img()!.getAttribute("sizes")).toBe("auto, (max-width: 800px) 100vw, 800px");
  });

  it("honours an explicit sizes prop", () => {
    const { img } = renderImage({ loading: "eager", sizes: "(max-width: 40em) 100vw, 40em" });

    expect(img()!.getAttribute("sizes")).toBe("(max-width: 40em) 100vw, 40em");
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
});

describe("bug ledger", () => {
  it("BUG-10: first paint should carry a srcset for the preload scanner", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("srcset")).not.toBeNull();
  });

  it("BUG-10: first paint should carry a sizes attribute", () => {
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
