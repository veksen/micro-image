import { IProviderOptions } from "./base";

// imgproxy implementation
export interface ImgProxyOptions extends IProviderOptions {}

/**
 * Percent-encodes every character outside printable ASCII, and nothing else.
 * imgproxy hands the decoded source straight to its HTTP client, which refuses a
 * URL carrying a raw non-ASCII or control character with "Source is
 * unreachable" before it fetches anything. Printable ASCII is left alone
 * because a stock imgproxy accepts all of it — space, `<`, `>`, `|` and friends
 * were checked against a running instance — and because escaping `%` would
 * double-escape a source that already carries `%20` into `%2520`. Runs are
 * matched whole so a surrogate pair reaches `encodeURIComponent` intact.
 */
function escapeOutsidePrintableAscii(src: string): string {
  return src.replace(/[^ -~]+/gu, (run) => encodeURIComponent(run));
}

/**
 * imgproxy expects the source URL as URL-safe base64 with the padding stripped
 * (https://docs.imgproxy.net/usage/processing#source-url). `btoa` emits the
 * standard alphabet, so `+`, `/` and `=` have to be translated away — a `/` in
 * particular would split the segment and corrupt the request. `btoa` also throws
 * on any code point above 255, which the escaping above has already removed.
 */
function encodeSourceUrl(src: string): string {
  return btoa(escapeOutsidePrintableAscii(src))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Builds one processing option: `%option_name:%argument1:...:%argumentN`
 * (https://docs.imgproxy.net/usage/processing#processing-options). Arguments
 * are positional, so dropping a missing one would promote every argument after
 * it: `rs` with no resizing type but a width of 400 would read as
 * `rs:400`, a resizing type named 400. Truncating at the first missing argument
 * emits a smaller option instead of a wrong one, and an option left with no
 * arguments is omitted entirely.
 *
 * Exported for its own tests: every option has one argument today, so nothing
 * else exercises the positional rule.
 */
export function processingOption(name: string, ...args: Array<number | string | undefined>) {
  const supplied: Array<number | string> = [];
  for (const arg of args) {
    if (arg === undefined) break;
    supplied.push(arg);
  }

  return supplied.length > 0 ? [name, ...supplied].join(":") : undefined;
}

export function generateUrl(options: ImgProxyOptions) {
  const processingOptions = [
    processingOption("w", options.width),
    processingOption("q", options.quality),
    processingOption("bl", options.blur),
  ].filter((option) => option !== undefined);

  const format = options.format || "jpg";

  // /%signature/%processing_options/%encoded_source_url.%extension — the
  // signature position is never empty: a deployment with no key and salt reads
  // the literal `insecure` there. Signed URLs are not generated here, because
  // the key would have to ship to the browser to compute the HMAC.
  const path = ["insecure", ...processingOptions, `${encodeSourceUrl(options.src)}.${format}`];

  return `${options.url}/${path.join("/")}`;
}
