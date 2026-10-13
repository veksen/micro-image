import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

/**
 * Everything the proxy refuses to fetch from, unless the operator trusts the
 * origin explicitly. Ranges are from the IANA special-purpose address
 * registries (RFC 6890 and its updates): anything not globally routable, plus
 * the transition prefixes that embed an IPv4 address and so could tunnel back
 * into private space.
 *
 * IPv4-mapped IPv6 (`::ffff:a.b.c.d`) needs no entry of its own: `BlockList`
 * applies the IPv4 rules to it, which `upstream-guard.test.ts` pins.
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

/**
 * Thrown for a destination the proxy will not fetch. `status` is what the
 * route answers with: 400 for a URL that is not one, 403 for one that is but
 * points somewhere it may not go.
 */
export class RefusedUpstreamError extends Error {
  readonly code = "EREFUSEDUPSTREAM";

  constructor(
    message: string,
    readonly status: 400 | 403
  ) {
    super(message);
    this.name = "RefusedUpstreamError";
  }
}

/**
 * Resolves a hostname and refuses the connection if any address it resolves to
 * is blocked.
 *
 * Checking here, rather than resolving once up front, is what defeats DNS
 * rebinding: the address that is checked is the address the socket connects
 * to, so a record that answers public to a pre-flight and private to the
 * connect has no second resolution to exploit.
 *
 * A hostname with one blocked address is refused outright rather than filtered
 * down to its public ones. A name that resolves into private space is not a
 * name the proxy should be fetching from at all.
 */
export const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "");
      return;
    }

    const blocked = addresses.find(({ address }) => isBlockedAddress(address));

    if (blocked || addresses.length === 0) {
      callback(
        new RefusedUpstreamError(
          `${hostname} resolves to ${blocked?.address ?? "nothing"}, which is not allowed`,
          403
        ),
        ""
      );
      return;
    }

    if (options.all) {
      callback(null, addresses);
    } else {
      callback(null, addresses[0]!.address, addresses[0]!.family);
    }
  });
};

interface UpstreamAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

/** Every untrusted request connects through these, so every one is checked. */
const guardedAgents: UpstreamAgents = {
  httpAgent: new http.Agent({ keepAlive: true, lookup: guardedLookup }),
  httpsAgent: new https.Agent({ keepAlive: true, lookup: guardedLookup }),
};

/**
 * Trusted origins get their own pool, so a kept-alive socket opened for one can
 * never be handed to an untrusted request.
 */
const trustedAgents: UpstreamAgents = {
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
 * Parses the trusted-origin allowlist: origins the operator vouches for, which
 * skip the address check entirely. This is how the proxy reaches an image host
 * on a private network, and how the test suite and benchmarks reach their
 * fixture origin on 127.0.0.1.
 *
 * Entries are compared as origins (scheme, host and port), so trusting
 * `http://127.0.0.1:4100` trusts nothing else on loopback. An entry that is not
 * an http(s) origin is a configuration error and throws at startup rather than
 * silently trusting nothing.
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

/** `TRUSTED_ORIGINS`, comma-separated. Unset means nothing is trusted. */
export function readTrustedOrigins(): Set<string> {
  return parseTrustedOrigins((process.env.TRUSTED_ORIGINS ?? "").split(","));
}

/**
 * Decides whether one URL may be fetched, and through which agents. Called for
 * the requested URL and again for every redirect hop.
 *
 * A hostname is checked when the socket resolves it (see `guardedLookup`). An
 * IP literal never reaches a lookup, so it is checked here instead. The URL
 * parser has already normalised the shorthand forms (`0x7f.1`, `2130706433`)
 * to dotted quads by this point.
 */
export function agentsFor(target: string, trustedOrigins: ReadonlySet<string>): UpstreamAgents {
  const url = parseHttpUrl(target);

  if (!url) {
    throw new RefusedUpstreamError("image is not an absolute http(s) URL", 400);
  }

  if (trustedOrigins.has(url.origin)) {
    return trustedAgents;
  }

  // IPv6 literals keep their brackets in `hostname`.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");

  if (net.isIP(host) !== 0 && isBlockedAddress(host)) {
    throw new RefusedUpstreamError(`${host} is not an allowed destination`, 403);
  }

  return guardedAgents;
}
