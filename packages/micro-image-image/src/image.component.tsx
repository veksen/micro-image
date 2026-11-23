import React, { useEffect, useMemo, useRef, useState } from "react";
import { useImageCacheConfig } from "./image-cache-provider";
import { IProviderOptions } from "./providers/base";

/** Used when the caller does not ask for a quality of its own. */
const defaultQuality = 75;

/**
 * `auto` sizes a lazy image from its own laid-out width. A browser without
 * `auto` skips the keyword and reads the fallback: the viewport, capped at the
 * intrinsic width when the build supplied one.
 */
const defaultSizes = (intrinsicWidth: number | undefined) =>
  intrinsicWidth === undefined
    ? "auto, 100vw"
    : `auto, (max-width: ${intrinsicWidth}px) 100vw, ${intrinsicWidth}px`;

/** The ladder steps by 100px and stops here, whatever the source width. */
const ladderStep = 100;
const ladderCeiling = 1900;

/**
 * Candidate widths, closed by the intrinsic width when it is known. A wider
 * candidate adds no pixels, only another encode and cache entry in the proxy.
 */
const ladderWidths = (intrinsicWidth: number | undefined) => {
  const top = Math.min(intrinsicWidth ?? ladderCeiling, ladderCeiling);
  const widths: number[] = [];
  for (let width = ladderStep; width < top; width += ladderStep) widths.push(width);
  widths.push(top);
  return widths;
};

interface GenerateSrcSetOptions {
  baseSrc: string;
  intrinsicWidth: number | undefined;
  cacheProxyUrl: string;
  generator: (options: IProviderOptions) => string;
  defaultGeneratorOptions?: Partial<IProviderOptions>;
}

const generateSrcSet = ({
  baseSrc,
  intrinsicWidth,
  cacheProxyUrl,
  generator,
  defaultGeneratorOptions,
}: GenerateSrcSetOptions) => {
  return ladderWidths(intrinsicWidth)
    .map((width) => {
      const url = generator({
        // `quality` leads the spread so a caller's own value wins. It used to
        // trail it, which meant generatorOptions.quality was accepted and then
        // silently overwritten with the default.
        quality: defaultQuality,
        ...defaultGeneratorOptions,
        url: cacheProxyUrl,
        src: baseSrc,
        width: width,
      });
      return `${url} ${width}w`;
    })
    .join(", ");
};

/**
 * What the build knows about one image. An adapter injects it as the `_micro`
 * prop, and a `?micro` import produces it. See ADR 0006.
 */
export interface MicroImage {
  src: string;
  /** Intrinsic pixel width. */
  width: number;
  /** Intrinsic pixel height. */
  height: number;
  /** Inline LQIP, painted behind an eager image while its box is measured. */
  placeholder?: string;
}

/**
 * Either the caller writes `src`, `width` and `height`, or `_micro` supplies
 * them. With `_micro`, any of the three can still be written, and the written
 * value wins.
 */
export type IImageProps<GeneratorOptions extends IProviderOptions> = {
  alt?: string;
  objectFit?: "none" | "cover" | "contain";
  generatorOptions?: Partial<GeneratorOptions>;
  /**
   * Overrides the computed `sizes`. Pass it for an eager image: the layout is
   * the one thing the component cannot know before the first paint.
   */
  sizes?: string;
  /**
   * Defaults to `lazy`, which lets the browser size the image from its own
   * container with `sizes="auto"`. Pass `eager` for an image above the fold,
   * together with a `sizes` that matches its layout.
   */
  loading?: "lazy" | "eager";
} & (
  | { src: string; width: number; height: number; _micro?: undefined }
  | { _micro: MicroImage; src?: string; width?: number; height?: number }
);

/**
 * Merges written props over `_micro`.
 *
 * Width and height only set the aspect ratio, so they are taken as a pair. A
 * lone written width, mixed with `_micro`'s height, would distort the box, so
 * it is ignored and `_micro`'s intrinsic pair is used instead.
 */
function resolveImage<GeneratorOptions extends IProviderOptions>(
  props: IImageProps<GeneratorOptions>
): { src: string; width: number; height: number } {
  const micro = props._micro;
  if (micro === undefined) {
    return { src: props.src, width: props.width, height: props.height };
  }

  const src = props.src ?? micro.src;
  if (props.width !== undefined && props.height !== undefined) {
    return { src, width: props.width, height: props.height };
  }
  return { src, width: micro.width, height: micro.height };
}

function Image<GeneratorOptions extends IProviderOptions = IProviderOptions>(
  props: IImageProps<GeneratorOptions>
): React.JSX.Element {
  const config = useImageCacheConfig();
  const { src, width, height } = resolveImage(props);

  /**
   * The src that failed to load, rather than a boolean.
   *
   * Comparing it against the current src is what makes recovery automatic: a
   * caller pointing the component at a different image gets a fresh attempt,
   * where a boolean would have latched and rendered nothing forever.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  const blurredImageSrc = config.generateUrl({
    ...config.defaultGeneratorOptions,
    ...props.generatorOptions,
    url: config.cacheProxyUrl,
    src,
    width: 500,
    blur: 5,
  });

  /**
   * Only the build knows the source's real width. A written `width` sets the
   * aspect ratio and is often the display size (`width={183}` on a 5272px
   * photo), so capping at it would serve a blurry image.
   */
  const intrinsicWidth = props._micro?.width;

  const srcSet = useMemo(() => {
    return generateSrcSet({
      baseSrc: src,
      intrinsicWidth,
      cacheProxyUrl: config.cacheProxyUrl,
      generator: config.generateUrl,
      defaultGeneratorOptions: {
        ...config.defaultGeneratorOptions,
        ...props.generatorOptions,
      },
    });
  }, [
    src,
    intrinsicWidth,
    props.generatorOptions,
    config.cacheProxyUrl,
    config.generateUrl,
    config.defaultGeneratorOptions,
  ]);

  const loading = props.loading ?? "lazy";

  /**
   * An eager image with no written `sizes` is the one case where nobody knows
   * the slot before layout. Rather than guess the viewport, it waits for its
   * box to be measured, and ships no srcset until then.
   */
  const measured = loading === "eager" && props.sizes === undefined;

  const imageRef = useRef<HTMLImageElement | null>(null);

  /**
   * The widest box seen so far, in CSS px rounded up to the ladder step. It
   * only ever rises: a narrower `sizes` never recovers bytes the browser has
   * already fetched, and would only add a fetch.
   */
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!measured) return;
    const img = imageRef.current;
    if (!img) return;

    const raiseTo = (width: number) => {
      const boxWidth = Math.ceil(width / ladderStep) * ladderStep;
      // an element that is not laid out yet reports 0
      if (boxWidth <= 0) return;
      setMeasuredWidth((previous) => (previous === null ? boxWidth : Math.max(previous, boxWidth)));
    };

    if (typeof ResizeObserver === "undefined") {
      // measure once rather than leave the box empty
      raiseTo(img.getBoundingClientRect().width);
      return;
    }

    let frame = 0;
    const observer = new ResizeObserver(([entry]: ResizeObserverEntry[]) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => raiseTo(entry.contentRect.width));
    });
    observer.observe(img);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // `failed` remounts the element, so the observer must follow the new node
  }, [measured, failed]);

  /**
   * The src whose real image has loaded. The inline placeholder comes off then,
   * or it would show through any transparent pixels for the life of the page.
   */
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const placeholder = loadedSrc === src ? undefined : props._micro?.placeholder;

  let imgSources: Pick<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "sizes">;
  if (!measured) {
    // the first paint carries a real `sizes`, so no JavaScript gates the fetch
    imgSources = {
      src: blurredImageSrc,
      srcSet,
      sizes: props.sizes ?? defaultSizes(intrinsicWidth),
    };
  } else if (measuredWidth === null) {
    // nothing to fetch yet; the inline placeholder, if any, fills the box
    imgSources = {};
  } else {
    imgSources = { srcSet, sizes: `${measuredWidth}px` };
  }

  return (
    <div
      style={
        {
          "--ratio": width / height,
          position: "relative",
          width: "100%",
          height: 0,
          paddingBottom: "calc((1 / var(--ratio)) * 100%)",
        } as React.CSSProperties
      }
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          ...(measured && placeholder
            ? {
                backgroundImage: `url("${placeholder}")`,
                // With `w` descriptors the browser gives the image the `sizes`
                // width as its natural width, so even `none` paints it at about
                // the box width: only `contain` letterboxes.
                backgroundSize: props.objectFit === "contain" ? "contain" : "cover",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
              }
            : {}),
        }}
      >
        {measured && !failed && (
          // Without JavaScript nothing measures the box, so this copy carries
          // the viewport fallback. With scripting on, a browser never parses a
          // noscript's content, so it costs no fetch.
          <noscript>
            <img
              srcSet={srcSet}
              sizes={defaultSizes(intrinsicWidth)}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: props.objectFit || "none",
              }}
              alt={props.alt || ""}
            />
          </noscript>
        )}
        {!failed && (
          <img
            {...imgSources}
            ref={imageRef}
            loading={loading}
            onLoad={() => setLoadedSrc(src)}
            onError={() => setFailedSrc(src)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: props.objectFit || "none",
            }}
            // until it has sources, the noscript copy is the image a no-JS reader meets
            alt={measured && measuredWidth === null ? "" : props.alt || ""}
          />
        )}
      </div>
    </div>
  );
}

Image.displayName = "Image";

export default Image;
