import { IProviderOptions } from "./base";

// imgproxy implementation
export interface ImgProxyOptions extends IProviderOptions {}

const getKeys = <T extends object>(obj: T) => Object.keys(obj) as Array<keyof T>;

export function generateUrl(options: ImgProxyOptions) {
  const imgProxyOptions = {
    w: [options.width],
    q: [options.quality],
    bl: [options.blur],
    el: [1],
    ex: [1],
  };

  // https://docs.imgproxy.net/usage/processing#processing-options
  const processingOptions = getKeys(imgProxyOptions)
    .filter((key) => imgProxyOptions[key].filter((value) => value !== undefined).length > 0)
    .map((key) => [key, ...imgProxyOptions[key]].join(":"))
    .join("/");

  const encodedSourceUrl = btoa(options.src);
  const format = options.format || "png";

  return `${options.url}/${processingOptions}/${encodedSourceUrl}.${format}`;
}
