import type { LookupAddress } from "dns";
import { describe, it, expect } from "vitest";
import { guardedLookup, isBlockedAddress, parseTrustedOrigins } from "./upstream-guard";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::127.0.0.1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a00:1",
    "2002:7f00:1::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["1.1.1.1", "93.184.216.34", "172.32.0.1", "::ffff:1.1.1.1", "2606:4700::1111"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    }
  );

  it.each(["", "localhost", "not an ip", "999.0.0.1"])("fails closed on %j", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });
});

function lookup(hostname: string, all: boolean) {
  return new Promise<{ error: Error | null; result: string | LookupAddress[] }>((resolve) => {
    guardedLookup(hostname, { all }, (error, result) => resolve({ error, result }));
  });
}

describe("guardedLookup", () => {
  it.each([true, false])("refuses a name that resolves to loopback (all: %s)", async (all) => {
    const { error } = await lookup("localhost", all);

    expect(error).toMatchObject({ name: "UpstreamError", status: 403 });
  });

  // An IP literal resolves to itself without touching the network.
  it("answers in the single-address shape when all is false", async () => {
    const { error, result } = await lookup("1.1.1.1", false);

    expect(error).toBeNull();
    expect(result).toBe("1.1.1.1");
  });

  it("answers in the list shape when all is true", async () => {
    const { error, result } = await lookup("1.1.1.1", true);

    expect(error).toBeNull();
    expect(result).toEqual([{ address: "1.1.1.1", family: 4 }]);
  });
});

describe("parseTrustedOrigins", () => {
  it("normalises entries to origins and skips blanks", () => {
    expect(
      parseTrustedOrigins([" http://127.0.0.1:4100/ignored/path ", "", "https://images.lan:443"])
    ).toEqual(new Set(["http://127.0.0.1:4100", "https://images.lan"]));
  });

  it.each(["127.0.0.1:4100", "ftp://files.lan", "not a url"])("throws on %j", (entry) => {
    expect(() => parseTrustedOrigins([entry])).toThrow(/trusted origin/);
  });
});
