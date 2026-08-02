/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { ImageCacheProvider, useImageCacheConfig, defaultConfig } from "./image-cache-provider";

afterEach(() => {
  cleanup();
});

const SRC = "https://example.com/cat.jpg";

function configIn(ui: Partial<React.ComponentProps<typeof ImageCacheProvider>>) {
  return renderHook(() => useImageCacheConfig(), {
    wrapper: ({ children }) => <ImageCacheProvider {...ui}>{children}</ImageCacheProvider>,
  }).result.current;
}

describe("useImageCacheConfig — current behaviour", () => {
  it("falls back to the default config outside a provider", () => {
    const { result } = renderHook(() => useImageCacheConfig());

    expect(result.current.provider).toBe(defaultConfig.provider);
    expect(result.current.cacheProxyUrl).toBe(defaultConfig.cacheProxyUrl);
  });

  it("returns a micro-image generator by default", () => {
    const { result } = renderHook(() => useImageCacheConfig());

    expect(result.current.generateUrl({ url: "http://p", src: SRC })).toContain("?image=");
  });

  it("selects the ipx generator", () => {
    const config = configIn({ provider: "ipx", cacheProxyUrl: "http://ipx" });

    expect(config.generateUrl({ url: "http://ipx", src: SRC })).toContain("image_");
  });

  it("selects the imgproxy generator", () => {
    const config = configIn({ provider: "imgproxy", cacheProxyUrl: "http://ip" });

    expect(config.generateUrl({ url: "http://ip", src: SRC })).toContain("/insecure/");
  });

  it("keeps the default proxy url when the provider supplies none", () => {
    const config = configIn({ provider: "ipx" });

    expect(config.cacheProxyUrl).toBe(defaultConfig.cacheProxyUrl);
  });

  it("passes defaultGeneratorOptions through untouched", () => {
    const config = configIn({ defaultGeneratorOptions: { quality: 42 } });

    expect(config.defaultGeneratorOptions).toEqual({ quality: 42 });
  });

  it("treats an empty-string proxy url as absent", () => {
    // `config.cacheProxyUrl || defaultConfig.cacheProxyUrl` is a truthiness
    // check, so "" silently becomes the default rather than being honoured
    const config = configIn({ cacheProxyUrl: "" });

    expect(config.cacheProxyUrl).toBe(defaultConfig.cacheProxyUrl);
  });
});
