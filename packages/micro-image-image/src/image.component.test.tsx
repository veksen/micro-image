/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import Image from "./image.component";
import { FakeImage, FakeResizeObserver, installDomStubs } from "./test-helpers";

const SRC = "https://example.com/cat.jpg";
const PROXY = "http://localhost:4000/cache";

beforeEach(() => {
  installDomStubs();
  // run the measured frame at once, so a resize reads as one synchronous step
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  /** The build's intrinsic width, which is the only width that caps the ladder. */
  const micro = (width: number) => ({ _micro: { src: SRC, width, height: 600 } });

  it("caps the srcset at _micro's intrinsic width", () => {
    const { img } = renderImage(micro(800));

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
    const { img } = renderImage(micro(850));

    expect(widths(img()!.srcset).slice(-2)).toEqual(["800w", "850w"]);
  });

  it("offers only the source width for a source narrower than one step", () => {
    const { img } = renderImage(micro(64));

    expect(widths(img()!.srcset)).toEqual(["64w"]);
  });

  it("still stops the srcset at 1900w for a wider source", () => {
    const { img } = renderImage(micro(4000));

    const candidates = widths(img()!.srcset);
    expect(candidates).toHaveLength(19);
    expect(candidates.at(-1)).toBe("1900w");
  });

  it("does not cap the srcset at a written width, which only sets the ratio", () => {
    // a 5272px photo shown in a small box, as the docs page writes it
    const { img } = renderImage({ width: 183, height: 137 });

    expect(widths(img()!.srcset).at(-1)).toBe("1900w");
  });

  it("caps at _micro's width even when a written width overrides the ratio", () => {
    const { img } = renderImage({ ...micro(800), width: 183, height: 137 });

    expect(widths(img()!.srcset).at(-1)).toBe("800w");
  });

  it("puts the requested width into each srcset candidate url", () => {
    const { img } = renderImage();

    expect(img()!.srcset).toContain("width=100&quality=75");
  });

  it("loads lazily by default and lets the browser size it with auto", () => {
    const { img } = renderImage();

    expect(img()!.getAttribute("loading")).toBe("lazy");
    expect(img()!.getAttribute("sizes")).toBe("auto, 100vw");
  });

  it("caps the sizes fallback at _micro's intrinsic width", () => {
    const { img } = renderImage(micro(800));

    expect(img()!.getAttribute("sizes")).toBe("auto, (max-width: 800px) 100vw, 800px");
  });

  it("ships no srcset for an eager image without sizes until its box is measured", () => {
    const { img } = renderImage({ loading: "eager" });

    expect(img()!.getAttribute("loading")).toBe("eager");
    expect(img()!.hasAttribute("srcset")).toBe(false);
    expect(img()!.hasAttribute("sizes")).toBe(false);
    // and no blurred placeholder request either
    expect(img()!.hasAttribute("src")).toBe(false);
  });

  it("sets srcset and sizes from the measured box, rounded up to the ladder step", () => {
    const { img } = renderImage({ loading: "eager" });

    act(() => FakeResizeObserver.instances[0].resizeTo(612));

    expect(img()!.getAttribute("sizes")).toBe("700px");
    expect(img()!.getAttribute("srcset")).toContain("800w");
  });

  it("only ever raises the measured sizes", () => {
    const { img } = renderImage({ loading: "eager" });
    const observer = FakeResizeObserver.instances[0];

    act(() => observer.resizeTo(612));
    act(() => observer.resizeTo(300));
    expect(img()!.getAttribute("sizes")).toBe("700px");

    act(() => observer.resizeTo(750));
    expect(img()!.getAttribute("sizes")).toBe("800px");
  });

  it("server-renders a noscript copy with a srcset for browsers without JavaScript", () => {
    const html = renderToString(<Image src={SRC} width={800} height={600} loading="eager" />);

    expect(html).toMatch(/<noscript><img srcSet="[^"]+" sizes="auto, 100vw"/);
    // nothing outside the noscript for React to preload at the viewport width
    expect(html).not.toContain('rel="preload"');
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = renderImage({ loading: "eager" });

    unmount();

    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
  });

  it("observes the remounted element after a failure, not the one it replaced", () => {
    const { img, rerender } = renderImage({ loading: "eager" });

    act(() => fireEvent.error(img()!));
    rerender(
      <Image
        src="https://example.com/dog.jpg"
        width={800}
        height={600}
        alt="a dog"
        loading="eager"
      />
    );

    const observer = FakeResizeObserver.instances.at(-1)!;
    expect(observer.observed[0]).toBe(img());
    act(() => observer.resizeTo(640));
    expect(img()!.getAttribute("sizes")).toBe("700px");
  });

  it("measures once when ResizeObserver is missing, rather than staying empty", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ width: 612 } as DOMRect);

    const { img } = renderImage({ loading: "eager" });

    expect(img()!.getAttribute("sizes")).toBe("700px");
    rect.mockRestore();
  });

  it("keeps the alt off the sourceless img until it is measured", () => {
    const { img } = renderImage({ loading: "eager" });
    expect(img()!.getAttribute("alt")).toBe("");

    act(() => FakeResizeObserver.instances[0]!.resizeTo(612));
    expect(img()!.getAttribute("alt")).toBe("a cat");
  });

  it("ignores a box that is not laid out yet", () => {
    const { img } = renderImage({ loading: "eager" });

    act(() => FakeResizeObserver.instances[0].resizeTo(0));

    expect(img()!.hasAttribute("srcset")).toBe(false);
  });

  it("does not measure an eager image whose sizes is written", () => {
    renderImage({ loading: "eager", sizes: "50vw" });

    expect(FakeResizeObserver.instances).toHaveLength(0);
  });

  it("shows _micro's placeholder inline behind an eager image being measured", () => {
    const placeholder = "data:image/jpeg;base64,AAAA";
    const { container } = render(
      <Image _micro={{ src: SRC, width: 800, height: 600, placeholder }} loading="eager" />
    );

    const box = container.querySelector("img")!.parentElement!;
    expect(box.style.backgroundImage).toBe(`url("${placeholder}")`);
  });

  it("takes the placeholder off once the real image has loaded", () => {
    const placeholder = "data:image/jpeg;base64,AAAA";
    const { container } = render(
      <Image _micro={{ src: SRC, width: 800, height: 600, placeholder }} loading="eager" />
    );
    const img = container.querySelector("img")!;

    act(() => fireEvent.load(img));

    expect(img.parentElement!.style.backgroundImage).toBe("");
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

describe("Image — _micro", () => {
  const MICRO = { src: "https://example.com/hero.jpg", width: 1600, height: 900 };

  function ratio(container: HTMLElement) {
    return (container.firstElementChild as HTMLElement).style.getPropertyValue("--ratio");
  }

  it("takes src and the aspect ratio from _micro when nothing is written", () => {
    const { container } = render(<Image _micro={MICRO} alt="hero" />);

    expect(container.querySelector("img")!.getAttribute("src")).toBe(
      `${PROXY}?image=${encodeURIComponent(MICRO.src)}&width=500&blur=5`
    );
    expect(ratio(container)).toBe(String(1600 / 900));
  });

  it("uses a written src over _micro's", () => {
    const { container } = render(<Image _micro={MICRO} src={SRC} alt="hero" />);

    expect(container.querySelector("img")!.getAttribute("src")).toContain(encodeURIComponent(SRC));
  });

  it("uses a written width and height over _micro's", () => {
    const { container } = render(<Image _micro={MICRO} width={800} height={400} alt="hero" />);

    expect(ratio(container)).toBe("2");
  });

  it("ignores a lone written width and keeps _micro's ratio", () => {
    // 800 / 900 would squash a 16:9 image into a near-square box
    const { container } = render(<Image _micro={MICRO} width={800} alt="hero" />);

    expect(ratio(container)).toBe(String(1600 / 900));
  });

  it("ignores a lone written height and keeps _micro's ratio", () => {
    const { container } = render(<Image _micro={MICRO} height={400} alt="hero" />);

    expect(ratio(container)).toBe(String(1600 / 900));
  });

  it("tries again when _micro points at a different src", () => {
    const { container, rerender } = render(<Image _micro={MICRO} alt="hero" />);

    act(() => fireEvent.error(container.querySelector("img")!));
    expect(container.querySelector("img")).toBeNull();

    rerender(<Image _micro={{ ...MICRO, src: "https://example.com/dog.jpg" }} alt="hero" />);

    expect(container.querySelector("img")).not.toBeNull();
  });

  it("requires src, width and height when there is no _micro", () => {
    // Type-level only: `npm run typecheck` fails if any of these compile.
    const assertions = () => {
      // @ts-expect-error width and height are missing
      void (<Image src={SRC} alt="" />);
      // @ts-expect-error height is missing
      void (<Image src={SRC} width={800} alt="" />);
      // @ts-expect-error src is missing
      void (<Image width={800} height={600} alt="" />);
    };

    expect(assertions).toBeTypeOf("function");
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
