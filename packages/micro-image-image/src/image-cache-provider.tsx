import React from "react";
import { generateUrl as generateUrlMicroImage } from "./providers/micro-image";
import { generateUrl as generateUrlIpx } from "./providers/ipx";
import { generateUrl as generateUrlImgProxy } from "./providers/imgproxy";
import { IProviderOptions } from "./providers/base";

export const defaultConfig: IImageCacheProviderConfig = {
  provider: "micro-image",
  cacheProxyUrl: "http://localhost:4000/cache",
};

// TODO: maybe support cloudinary, imgix, anything else?
type SupportedProviders = "micro-image" | "ipx" | "imgproxy";

export interface IImageCacheProviderConfig<
  GeneratorOptions extends IProviderOptions = IProviderOptions,
> {
  provider: SupportedProviders;
  cacheProxyUrl: string;
  defaultGeneratorOptions?: Partial<GeneratorOptions>;
}

const ImageCacheContext = React.createContext<IImageCacheProviderConfig | null>(null);

type ImageCacheProviderProps = Partial<IImageCacheProviderConfig> & {
  children: React.ReactNode;
};

export function ImageCacheProvider(config: ImageCacheProviderProps) {
  return (
    <ImageCacheContext.Provider
      value={{
        provider: config.provider || defaultConfig.provider,
        cacheProxyUrl: config.cacheProxyUrl || defaultConfig.cacheProxyUrl,
        defaultGeneratorOptions: config.defaultGeneratorOptions,
      }}
    >
      {config.children}
    </ImageCacheContext.Provider>
  );
}

function getGeneralUrlFunction(provider: SupportedProviders) {
  switch (provider) {
    case "ipx":
      return generateUrlIpx;
    case "imgproxy":
      return generateUrlImgProxy;
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

  return { ...config, generateUrl: getGeneralUrlFunction(config.provider) };
}
