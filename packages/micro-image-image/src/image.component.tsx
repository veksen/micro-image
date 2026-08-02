import React, { useEffect, useMemo, useRef, useState } from "react";
import useImage from "./use-image.hook";
import { useImageCacheConfig } from "./image-cache-provider";
import { IProviderOptions } from "./providers/base";

/** Used when the caller does not ask for a quality of its own. */
const defaultQuality = 75;

/**
 * `sizes="auto"` tells the browser to pick the candidate from the element's own
 * post-layout width — container-width selection with no JavaScript at all,
 * which is the north star. Two constraints shape the value below:
 *
 * - it is only honoured on a lazily loaded image, because the browser needs
 *   layout to have happened before the fetch begins;
 * - browsers that do not support it (Safari, at the time of writing) skip the
 *   keyword and read the rest of the list, hence the `100vw` after it.
 *
 * `100vw` is an upper bound rather than a guess: the wrapper is `width: 100%`,
 * so the image can never be wider than the viewport. Overshooting costs bytes;
 * undershooting would render a blurry image, which is not recoverable.
 */
const lazySizes = "auto, 100vw";

/** An eagerly loaded image cannot use `auto`, so it gets the bound alone. */
const eagerSizes = "100vw";

interface GenerateSrcSetOptions {
  baseSrc: string;
  cacheProxyUrl: string;
  generator: (options: IProviderOptions) => string;
  defaultGeneratorOptions?: Partial<IProviderOptions>;
}

const generateSrcSet = ({
  baseSrc,
  cacheProxyUrl,
  generator,
  defaultGeneratorOptions,
}: GenerateSrcSetOptions) => {
  return Array.from({ length: 20 })
    .map((_, index) => index)
    .slice(1)
    .map((index) => {
      const width = index * 100;
      const url = generator({
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

export interface IImageProps<GeneratorOptions extends IProviderOptions> {
  src: string;
  width: number;
  height: number;
  alt?: string;
  objectFit?: "none" | "cover" | "contain";
  generatorOptions?: Partial<GeneratorOptions>;
  /**
   * Overrides the computed `sizes`. Supplying it also switches off the resize
   * observer: a caller who knows its layout does not need us to measure it.
   */
  sizes?: string;
  /**
   * Defaults to `lazy`, which is what makes `sizes="auto"` legal. Pass `eager`
   * for an image above the fold — an LCP candidate must not be deferred.
   */
  loading?: "lazy" | "eager";
}

function Image<GeneratorOptions extends IProviderOptions = IProviderOptions>(
  props: IImageProps<GeneratorOptions>
): React.JSX.Element {
  const config = useImageCacheConfig();

  const imageRef = useRef<HTMLImageElement | null>(null);

  /**
   * The container width once layout has run, as a `sizes` value.
   *
   * This is a refinement, not the mechanism. A browser supporting
   * `sizes="auto"` has already made the same choice without us; this exists so
   * that one which does not still narrows from the `100vw` bound to the real
   * container. It is React state rather than a direct DOM write, because the
   * observer used to mutate `imgEl.srcset`/`imgEl.sizes` behind React's back
   * and any re-render touching the `<img>` wiped both.
   */
  const [measuredSizes, setMeasuredSizes] = useState<string | null>(null);

  // `quality` leads the spread so a caller's own value wins. It used to trail
  // it, which meant generatorOptions.quality was accepted and then overwritten.
  const imageSrc = config.generateUrl({
    quality: defaultQuality,
    ...config.defaultGeneratorOptions,
    ...props.generatorOptions,
    url: config.cacheProxyUrl,
    src: props.src,
  });

  const blurredImageSrc = config.generateUrl({
    ...config.defaultGeneratorOptions,
    ...props.generatorOptions,
    url: config.cacheProxyUrl,
    src: props.src,
    width: 500,
    blur: 5,
  });

  const { error } = useImage(imageSrc);

  const srcSet = useMemo(() => {
    return generateSrcSet({
      baseSrc: props.src,
      cacheProxyUrl: config.cacheProxyUrl,
      generator: config.generateUrl,
      defaultGeneratorOptions: {
        ...config.defaultGeneratorOptions,
        ...props.generatorOptions,
      },
    });
  }, [
    props.src,
    props.generatorOptions,
    config.cacheProxyUrl,
    config.generateUrl,
    config.defaultGeneratorOptions,
  ]);

  const loading = props.loading ?? "lazy";

  /**
   * Resolved in precedence order: what the caller asked for, then what layout
   * told us, then the static bound. Every one of them is a real value, so the
   * first paint carries a `sizes` — which is the point of the fix.
   */
  const sizes = props.sizes ?? measuredSizes ?? (loading === "lazy" ? lazySizes : eagerSizes);

  useEffect(() => {
    // a caller who passed `sizes` owns it; measuring would only fight them
    if (props.sizes) return;
    if (!imageRef.current) return;
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(([entry]: ResizeObserverEntry[]) => {
      const { width } = entry.contentRect;
      // an unlaid-out element reports 0, which would round up to a 100w image
      if (width <= 0) return;

      setMeasuredSizes(`${Math.ceil(Math.floor(width) / 100) * 100}px`);
    });

    observer.observe(imageRef.current);

    return () => {
      observer.disconnect();
    };
  }, [props.sizes]);

  return (
    <div
      style={
        {
          "--ratio": props.width / props.height,
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
        }}
      >
        {!error && (
          <img
            src={blurredImageSrc}
            srcSet={srcSet}
            sizes={sizes}
            loading={loading}
            ref={imageRef}
            style={{
              width: "100%",
              height: "100%",
              objectFit: props.objectFit || "none",
            }}
            alt={props.alt || ""}
          />
        )}
      </div>
    </div>
  );
}

Image.displayName = "Image";

export default Image;
