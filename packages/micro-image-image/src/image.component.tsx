import React, { useEffect, useMemo, useRef, useState } from "react";
import { useImageCacheConfig } from "./image-cache-provider";
import { IProviderOptions } from "./providers/base";

/** Used when the caller does not ask for a quality of its own. */
const defaultQuality = 75;

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
  /** Inline LQIP. Accepted, not rendered yet. */
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

  const imageRef = useRef<HTMLImageElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

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

  const srcSet = useMemo(() => {
    return generateSrcSet({
      baseSrc: src,
      cacheProxyUrl: config.cacheProxyUrl,
      generator: config.generateUrl,
      defaultGeneratorOptions: {
        ...config.defaultGeneratorOptions,
        ...props.generatorOptions,
      },
    });
  }, [
    src,
    props.generatorOptions,
    config.cacheProxyUrl,
    config.generateUrl,
    config.defaultGeneratorOptions,
  ]);

  useEffect(() => {
    if (!imageRef.current) return;
    if (typeof window === "undefined") return;

    observerRef.current = new ResizeObserver(([entry]: ResizeObserverEntry[]) => {
      requestAnimationFrame(() => {
        const { width } = entry.contentRect;
        if (!imageRef.current) return;

        const imgEl = imageRef.current;
        const widthToRender = Math.ceil(Math.floor(width) / 100) * 100;

        if (imgEl.sizes !== `${widthToRender}px`) {
          imgEl.sizes = `${widthToRender}px`;
        }

        if (imgEl.srcset !== srcSet) {
          imgEl.srcset = srcSet;
        }
      });
    });

    observerRef.current.observe(imageRef.current);

    return () => {
      observerRef.current?.disconnect();
    };
    // `failed` unmounts and remounts the element, so the observer has to be
    // pointed at the new node rather than left watching the detached one
  }, [srcSet, failed]);

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
        }}
      >
        {!failed && (
          <img
            src={blurredImageSrc}
            onError={() => setFailedSrc(src)}
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
