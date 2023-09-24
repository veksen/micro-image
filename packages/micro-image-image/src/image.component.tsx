import React, { useEffect, useMemo, useRef } from "react";
import useImage from "./use-image.hook";
import { useImageCacheConfig } from "./image-cache-provider";
import { IProviderOptions } from "./providers/base";

// TODO: remove hardcode
const quality = 75;

const generateSrcSet = (
  baseSrc: string,
  cacheProxyUrl: string,
  generator: (options: IProviderOptions) => string
) => {
  return Array.from({ length: 20 })
    .map((_, index) => index)
    .slice(1)
    .map((index) => {
      const width = index * 100;
      const url = generator({
        url: cacheProxyUrl,
        src: baseSrc,
        width: width,
        quality: quality,
      });
      return `${url} ${width}w`;
    })
    .join(", ");
};

export interface IImageProps {
  src: string;
  width: number;
  height: number;
  alt?: string;
  objectFit?: "none" | "cover" | "contain";
}

function Image(props: IImageProps): JSX.Element {
  const config = useImageCacheConfig();

  const imageRef = useRef<HTMLImageElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const imageSrc = config.generateUrl({
    url: config.cacheProxyUrl,
    src: props.src,
    quality: quality,
  });
  const blurredImageSrc = config.generateUrl({
    url: config.cacheProxyUrl,
    src: props.src,
    width: 500,
    blur: true,
  });

  const { error } = useImage(imageSrc);

  const srcSet = useMemo(() => {
    return generateSrcSet(props.src, config.cacheProxyUrl, config.generateUrl);
  }, [props.src, config.cacheProxyUrl, config.generateUrl]);

  useEffect(() => {
    if (!imageRef.current) return;

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
  }, [srcSet]);

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
