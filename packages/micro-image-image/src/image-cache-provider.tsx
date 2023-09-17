import React from "react";
import { generateUrl as generateUrlMicroImage } from "./providers/micro-image";
import { generateUrl as generateUrlIpx } from "./providers/ipx";

export const defaultConfig: IImageCacheProviderConfig = {
  provider: "micro-image",
  cacheProxyUrl: "http://localhost:4000/cache",
};

export interface IImageCacheProviderConfig {
  // TODO: maybe support cloudinary, imgix, anything else?
  provider: "micro-image" | "ipx";
  cacheProxyUrl: string;
}

const ImageCacheContext = React.createContext<IImageCacheProviderConfig | null>(
  null
);

type ImageCacheProviderProps = Partial<IImageCacheProviderConfig> & {
  children: React.ReactNode;
};

export function ImageCacheProvider(config: ImageCacheProviderProps) {
  return (
    <ImageCacheContext.Provider
      value={{
        provider: config.provider || defaultConfig.provider,
        cacheProxyUrl: config.cacheProxyUrl || defaultConfig.cacheProxyUrl,
      }}
    >
      {config.children}
    </ImageCacheContext.Provider>
  );
}

function getGeneralUrlFunction(provider: "micro-image" | "ipx") {
  switch (provider) {
    case "ipx":
      return generateUrlIpx;
    case "micro-image":
    default:
      return generateUrlMicroImage;
  }
}

export function useImageCacheConfig() {
  const config = React.useContext(ImageCacheContext);

  if (!config) {
    return { ...defaultConfig, generateUrl: getGeneralUrlFunction(defaultConfig.provider) };
  }

  return { ...config, generateUrl: getGeneralUrlFunction(defaultConfig.provider) };
}
