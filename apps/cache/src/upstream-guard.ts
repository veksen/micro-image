import axios from "axios";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

/**
 * The IANA special-purpose ranges (RFC 6890): nothing globally routable, plus
 * the IPv6 prefixes that embed an IPv4 address. `BlockList` applies the IPv4
 * rules to IPv4-mapped IPv6 (`::ffff:a.b.c.d`) on its own.
 */
const blockedRanges = new net.BlockList();

for (const [prefix, length] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata at 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including broadcast
  ["::", 96], // unspecified, loopback, and deprecated IPv4-compatible
  ["64:ff9b::", 96], // NAT64, embeds IPv4
  ["64:ff9b:1::", 48], // local-use NAT64
  ["100::", 64], // discard
  ["2001::", 32], // Teredo, embeds IPv4
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4, embeds IPv4
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // deprecated site-local
  ["ff00::", 8], // multicast
] as const) {
  blockedRanges.addSubnet(prefix, length, net.isIPv6(prefix) ? "ipv6" : "ipv4");
}

/** Fails closed: anything that is not a parseable IP address is blocked. */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);

  if (family === 0) {
    return true;
  }

  return blockedRanges.check(address, family === 6 ? "ipv6" : "ipv4");
}

const unreachable = "could not fetch the image from upstream";

/**
 * Every way obtaining an image can fail, with the status the route answers and
 * the message it may show. `message` can name a resolved address, so it only
 * goes to the log.
 */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 502 | 504,
    readonly clientMessage = message,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "UpstreamError";
  }
}

/**
 * Refuses the connection if the hostname resolves to any blocked address.
 * Checking inside the socket's own lookup is what defeats DNS rebinding: the
 * address checked is the address connected to.
 */
export const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "");
      return;
    }

    const blocked = addresses.find(({ address }) => isBlockedAddress(address));

    if (blocked) {
      const error = new UpstreamError(
        `${hostname} resolves to ${blocked.address}`,
        403,
        "image URL resolves to a destination that is not allowed"
      );
      callback(error, "");
      return;
    }

    if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0]!.address, addresses[0]!.family);
    }
  });
};

const guardedAgents = {
  httpAgent: new http.Agent({ keepAlive: true, lookup: guardedLookup }),
  httpsAgent: new https.Agent({ keepAlive: true, lookup: guardedLookup }),
};

// A separate pool, so a kept-alive trusted socket never serves an untrusted request.
const trustedAgents = {
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
};

/** The URL, if `value` is an absolute http(s) URL. */
function parseHttpUrl(value: string): URL | undefined {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
}

/**
 * Origins that skip the address check, compared on scheme, host and port. A bad
 * entry throws at startup rather than silently trusting nothing.
 */
export function parseTrustedOrigins(entries: readonly string[]): Set<string> {
  const origins = new Set<string>();

  for (const entry of entries) {
    const trimmed = entry.trim();

    if (trimmed === "") {
      continue;
    }

    const url = parseHttpUrl(trimmed);

    if (!url) {
      throw new Error(`trusted origin "${trimmed}" is not an http(s) URL`);
    }

    origins.add(url.origin);
  }

  return origins;
}

/**
 * Picks the agents for one URL, called for every redirect hop. Node skips the
 * lookup for an IP literal, so literals are checked here. `URL` has already
 * normalised `0x7f.1` and `2130706433` to dotted quads.
 */
function agentsFor(target: string, trustedOrigins: ReadonlySet<string>) {
  const url = parseHttpUrl(target);

  if (!url) {
    throw new UpstreamError("image is not an absolute http(s) URL", 400);
  }

  if (trustedOrigins.has(url.origin)) {
    return trustedAgents;
  }

  // IPv6 literals keep their brackets in `hostname`.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");

  if (net.isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new UpstreamError(`${host} is not an allowed destination`, 403);
  }

  return guardedAgents;
}

/**
 * Turns any failure to obtain the image into an `UpstreamError`. None is an
 * error of the proxy, so none reads as a 500. A refusal from the lookup arrives
 * wrapped by axios. A 400 here came from a redirect target, so it is the
 * upstream's fault.
 */
export function toUpstreamError(error: unknown): UpstreamError {
  const cause = axios.isAxiosError(error) ? error.cause : error;

  if (cause instanceof UpstreamError && cause.status !== 400) {
    return cause;
  }

  const code = axios.isAxiosError(error) ? error.code : undefined;
  const status = code === "ECONNABORTED" || code === "ETIMEDOUT" ? 504 : 502;

  return new UpstreamError(String(error), status, unreachable, { cause: error });
}

export const MAX_REDIRECTS = 5;

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export interface UpstreamOptions {
  trustedOrigins: ReadonlySet<string>;
  timeoutMs: number;
  maxBytes: number;
}

export function createUpstream({ trustedOrigins, timeoutMs, maxBytes }: UpstreamOptions) {
  return {
    /** Throws an `UpstreamError` for a malformed URL or a blocked IP literal. */
    check(url: string): void {
      agentsFor(url, trustedOrigins);
    },

    async fetch(url: string) {
      // One deadline for the whole chain, so redirects cannot stretch the limit.
      const deadline = Date.now() + timeoutMs;

      let target = url;

      for (let redirects = 0; ; redirects++) {
        // responseType "arraybuffer" resolves to a Buffer under Node's adapter,
        // which lets the route use the body directly without a copy.
        const response = await axios<Buffer>(target, {
          ...agentsFor(target, trustedOrigins),
          responseType: "arraybuffer",
          timeout: Math.max(1, deadline - Date.now()),
          // axios tracks the running total and destroys the stream once it is
          // passed, so an oversized body is refused rather than fully buffered.
          maxContentLength: maxBytes,
          maxBodyLength: maxBytes,
          // This loop follows redirects, so every hop goes back through agentsFor.
          maxRedirects: 0,
          // A forward proxy would resolve hostnames out of reach of the check.
          proxy: false,
          validateStatus: (status) =>
            (status >= 200 && status < 300) || redirectStatuses.has(status),
        });

        if (!redirectStatuses.has(response.status)) {
          return response;
        }

        const location = response.headers.location as string | undefined;

        if (!location) {
          throw new Error("redirect without a location");
        }

        if (redirects === MAX_REDIRECTS) {
          throw new Error(`more than ${MAX_REDIRECTS} redirects`);
        }

        target = new URL(location, target).href;
      }
    },
  };
}
