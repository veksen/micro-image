import React, { useMemo, useState } from "react";
import { useImageCacheConfig } from "./image-cache-provider";
import { IProviderOptions } from "./providers/base";

/** Used when the caller does not ask for a quality of its own. */
const defaultQuality = 75;

/**
 * `auto` sizes a lazy image from its own laid-out width. An eager image, or a
 * browser without `auto`, skips the keyword and reads the fallback: the
 * viewport capped at the intrinsic width. That fallback is never too small, and
 * too large whenever the image is narrower than the viewport, so an eager image
 * should pass its own `sizes`.
 */
const defaultSizes = (intrinsicWidth: number) =>
  `auto, (max-width: ${intrinsicWidth}px) 100vw, ${intrinsicWidth}px`;

/** The ladder steps by 100px and stops here, whatever the source width. */
const ladderStep = 100;
const ladderCeiling = 1900;

/**
 * Candidate widths, closed by the intrinsic width. A wider candidate adds no
 * pixels, only another encode and cache entry in the proxy.
 */
const ladderWidths = (intrinsicWidth: number) => {
  const top = Math.min(intrinsicWidth, ladderCeiling);
  const widths: number[] = [];
  for (let width = ladderStep; width < top; width += ladderStep) widths.push(width);
  widths.push(top);
  return widths;
};

interface GenerateSrcSetOptions {
  baseSrc: string;
  intrinsicWidth: number;
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

export interface IImageProps<GeneratorOptions extends IProviderOptions> {
  src: string;
  width: number;
  height: number;
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
}

function Image<GeneratorOptions extends IProviderOptions = IProviderOptions>(
  props: IImageProps<GeneratorOptions>
): React.JSX.Element {
  const config = useImageCacheConfig();

  /**
   * The src that failed to load, rather than a boolean.
   *
   * Comparing it against the current src is what makes recovery automatic: a
   * caller pointing the component at a different image gets a fresh attempt,
   * where a boolean would have latched and rendered nothing forever.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === props.src;

  const blurredImageSrc = config.generateUrl({
    ...config.defaultGeneratorOptions,
    ...props.generatorOptions,
    url: config.cacheProxyUrl,
    src: props.src,
    width: 500,
    blur: 5,
  });

  const srcSet = useMemo(() => {
    return generateSrcSet({
      baseSrc: props.src,
      intrinsicWidth: props.width,
      cacheProxyUrl: config.cacheProxyUrl,
      generator: config.generateUrl,
      defaultGeneratorOptions: {
        ...config.defaultGeneratorOptions,
        ...props.generatorOptions,
      },
    });
  }, [
    props.src,
    props.width,
    props.generatorOptions,
    config.cacheProxyUrl,
    config.generateUrl,
    config.defaultGeneratorOptions,
  ]);

  const loading = props.loading ?? "lazy";

  // Either way the first paint carries a real `sizes`, so no JavaScript gates the fetch.
  const sizes = props.sizes ?? defaultSizes(props.width);

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
        {!failed && (
          <img
            src={blurredImageSrc}
            srcSet={srcSet}
            sizes={sizes}
            loading={loading}
            onError={() => setFailedSrc(props.src)}
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
