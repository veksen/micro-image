import React from "react";

export const defaultConfig: IImageCacheProviderConfig = {
  provider: "micro-image",
};

export interface IImageCacheProviderConfig {
  // TODO: maybe support cloudinary, imgix, anything else?
  provider: "micro-image" | "ipx";
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
      }}
    >
      {config.children}
    </ImageCacheContext.Provider>
  );
}

export function useImageCacheConfig() {
  const config = React.useContext(ImageCacheContext);

  if (!config) {
    return defaultConfig;
  }

  return config;
}
