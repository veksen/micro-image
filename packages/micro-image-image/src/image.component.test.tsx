/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
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

describe("Image — first paint", () => {
  it("keeps the blurred placeholder as the src for browsers without srcset", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("src")).toBe(
      `${PROXY}?image=${encodeURIComponent(SRC)}&width=500&blur=5`
    );
  });

  it("generates 19 srcset candidates from 100w to 1900w", () => {
    const { img } = renderImage();

    const candidates = img()!.srcset.split(", ");
    expect(candidates).toHaveLength(19);
    expect(candidates[0]).toContain(" 100w");
    expect(candidates[18]).toContain(" 1900w");
  });

  it("puts the requested width into each srcset candidate url", () => {
    const { img } = renderImage();

    expect(img()!.srcset).toContain("width=100&quality=75");
  });

  it("loads lazily by default, which is what makes sizes=auto legal", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("loading")).toBe("lazy");
    expect(img()!.getAttribute("sizes")).toBe("auto, 100vw");
  });

  it("drops the auto keyword when the caller asks to load eagerly", () => {
    const { img } = renderImage({ loading: "eager" });

    // `auto` is ignored on a non-lazy image, so advertising it would mislead
    expect(img()!.getAttribute("loading")).toBe("eager");
    expect(img()!.getAttribute("sizes")).toBe("100vw");
  });
});

describe("Image — sizes refinement", () => {
  it("narrows sizes to the observed container width", () => {
    const { img } = renderImage();

    act(() => FakeResizeObserver.instances[0]!.resizeTo(640));

    expect(img()!.getAttribute("sizes")).toBe("700px");
  });

  it("rounds the observed width up to the next 100px bucket", () => {
    const { img } = renderImage();

    act(() => FakeResizeObserver.instances[0]!.resizeTo(601));

    expect(img()!.getAttribute("sizes")).toBe("700px");
  });

  it("ignores a zero width rather than asking for the 100w candidate", () => {
    const { img } = renderImage();

    act(() => FakeResizeObserver.instances[0]!.resizeTo(0));

    expect(img()!.getAttribute("sizes")).toBe("auto, 100vw");
  });

  it("honours an explicit sizes prop and does not observe at all", () => {
    const { img } = renderImage({ sizes: "(max-width: 40em) 100vw, 40em" });

    expect(img()!.getAttribute("sizes")).toBe("(max-width: 40em) 100vw, 40em");
    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it("survives a re-render, because sizes and srcset are props not DOM writes", () => {
    const { img, rerender } = renderImage();

    act(() => FakeResizeObserver.instances[0]!.resizeTo(640));
    rerender(<Image src={SRC} width={800} height={600} alt="a cat" />);

    expect(img()!.getAttribute("sizes")).toBe("700px");
    expect(img()!.srcset).toContain(" 100w");
  });
});

describe("Image — the discarded preflight fetch [BUG-1]", () => {
  it("downloads a full-size variant whose bytes are never used", () => {
    renderImage();

    // useImage(imageSrc) is called with the un-sized url — the largest
    // variant the proxy will produce — and only `error` is read from it
    expect(FakeImage.instances).toHaveLength(1);
    expect(FakeImage.instances[0]!.src).toBe(
      `${PROXY}?image=${encodeURIComponent(SRC)}&quality=75`
    );
  });

  it("requests a url that is not the one the img element renders", () => {
    const { img } = renderImage();

    expect(FakeImage.instances[0]!.src).not.toBe(img()!.getAttribute("src"));
  });

  it("does not appear in the srcset either, so the bytes are pure waste", () => {
    const { img } = renderImage();

    expect(img()!.srcset).not.toContain(FakeImage.instances[0]!.src);
  });
});

describe("Image — load state is not used [BUG-9]", () => {
  it("renders the img before the preflight image has loaded", () => {
    const { img } = renderImage();

    // `loaded` and `fetching` come back from useImage but nothing gates on them
    expect(img()).not.toBeNull();
  });

  it("removes the img only once the preflight image errors", () => {
    const { img } = renderImage();
    expect(img()).not.toBeNull();

    act(() => FakeImage.instances[0]!.fireError());

    expect(img()).toBeNull();
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

  it.fails("BUG-1: no image should be fetched whose bytes are discarded", () => {
    const { img } = renderImage();

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
