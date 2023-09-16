import React, { useEffect, useMemo, useRef } from "react";
import useImage from "./use-image.hook";
import { useImageCacheConfig } from "./image-cache-provider";
import { IProviderOptions } from "./providers/base";

// TODO: remove hardcode
const cacheProxy = "http://localhost:4000/cache";
const quality = 75;
const format = "jpg";

const generateSrcSet = (baseSrc: string, generator: (options: IProviderOptions) => string) => {
  return Array.from({ length: 20 })
    .map((_, index) => index)
    .slice(1)
    .map((index) => {
      const width = index * 100;
      const url = generator({
        url: cacheProxy,
        src: baseSrc,
        format: format,
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

  const blurredImageSrc = config.generateUrl({
    url: cacheProxy,
    src: props.src,
    width: 500,
    blur: true,
  });

  const { error } = useImage(props.src);

  const srcSet = useMemo(() => {
    return generateSrcSet(props.src, config.generateUrl);
  }, [props.src, config.generateUrl]);

  const handleMount = () => {
    if (!imageRef.current) return;
    if (typeof window === "undefined") return;

    observerRef.current = new ResizeObserver(
      ([entry]: ResizeObserverEntry[]) => {
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
      }
    );

    observerRef.current.observe(imageRef.current);
  };

  useEffect(() => {
    if (!imageRef.current) return;

    handleMount();

    return () => {
      observerRef.current?.disconnect();
    };
  }, []);

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
