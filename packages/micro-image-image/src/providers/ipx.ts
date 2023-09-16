import { IProviderOptions } from "./base";

// ipx implementation
interface IPXOptions extends IProviderOptions {
  url: string;
  src: string;
  width?: number;
  quality?: number;
  format?: string;
}

// TODO
export function generateUrl(options: IPXOptions) {
  return options.src;
}
