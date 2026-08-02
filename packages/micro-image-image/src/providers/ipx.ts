import { IProviderOptions } from "./base";

// ipx implementation
export interface IPXOptions extends IProviderOptions {}

const getKeys = <T extends object>(obj: T) => Object.keys(obj) as Array<keyof T>;

// ipx parses `/<modifiers>/<id>`: it splits the path on "/", reads the first
// segment as a comma-separated modifier list, and joins the rest back into the
// source id, which it then decodeURIComponent()s. A literal "_" means "no
// modifiers"; an empty first segment is a 400 (IPX_MISSING_MODIFIERS).
// https://github.com/unjs/ipx#image-urls — parseIPXURL() in ipx's src/server.ts.
export function generateUrl(options: IPXOptions) {
  // ipx has no `image` modifier: the source travels in the trailing path
  // segment, not in this list.
  const ipxOptions = {
    width: options.width,
    format: options.format,
    quality: options.quality,
    blur: options.blur,
  };

  const ipxOptionsString =
    getKeys(ipxOptions)
      .filter((key) => ipxOptions[key] !== undefined)
      // Values are encoded too — ipx decodes each one, and it keeps a
      // caller-supplied `format` from smuggling a "," into the modifier list.
      .map((key) => [key, encodeURIComponent(String(ipxOptions[key]))].join("_"))
      .join(",") || "_";

  // Encoded whole, so the source stays one path segment and survives ipx's
  // decode intact — slashes, query string and fragment included.
  return `${options.url}/${ipxOptionsString}/${encodeURIComponent(options.src)}`;
}
