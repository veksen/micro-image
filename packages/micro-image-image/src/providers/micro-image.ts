import { IProviderOptions } from "./base";

// micro-image implementation
export interface MicroImageOptions extends IProviderOptions {}

const getKeys = <T extends object>(obj: T) => Object.keys(obj) as Array<keyof T>;

export function generateUrl(options: MicroImageOptions) {
  const encodedImage = encodeURIComponent(options.src);
  const params = {
    image: encodedImage,
    width: options.width,
    format: options.format,
    quality: options.quality,
    blur: Boolean(options.blur),
  };

  const queryParams = getKeys(params)
    .filter((key) => params[key] !== undefined)
    .map((key) => [key, params[key]].join("="))
    .join("&");

  return `${options.url}?${queryParams}`;
}
