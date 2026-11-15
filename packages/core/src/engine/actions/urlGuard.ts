import dns from "node:dns";
import net from "node:net";
import { Agent } from "undici";

export const BLOCKED_CODE = "EBLOCKED_DESTINATION";
const PRIVATE_MESSAGE = "Blocked: destination is a private or reserved address";

export class BlockedDestinationError extends Error {
  code = BLOCKED_CODE;
  constructor(message: string = PRIVATE_MESSAGE) {
    super(message);
    this.name = "BlockedDestinationError";
  }
}

const blocked = new net.BlockList();

const V4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes the cloud metadata address
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes broadcast
];
for (const [address, prefix] of V4_RANGES) blocked.addSubnet(address, prefix, "ipv4");

const V6_RANGES: Array<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["64:ff9b::", 96], // NAT64, can embed private IPv4 addresses
];
for (const [address, prefix] of V6_RANGES) blocked.addSubnet(address, prefix, "ipv6");

// Fails closed: anything that is not a clean IP address counts as blocked.
export function isBlockedAddress(address: string): boolean {
  const family = net.isIPv6(address) ? "ipv6" : net.isIPv4(address) ? "ipv4" : null;
  if (!family) return true;
  try {
    return blocked.check(address, family);
  } catch {
    return true;
  }
}

// Fast pre-check on the URL itself. Catches bad schemes, embedded credentials, and
// IP-literal hosts (the URL parser normalizes forms like http://2130706433/ to 127.0.0.1).
export function assertSafeUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedDestinationError("Blocked: invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedDestinationError(`Blocked: unsupported URL scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new BlockedDestinationError("Blocked: URLs with embedded credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new BlockedDestinationError();
  }
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new BlockedDestinationError();
  }
}

// DNS hook used by the HTTP agent: every address a hostname resolves to is checked
// at connect time, which also defeats DNS rebinding.
export function guardedLookup(hostname: string, options: any, callback: any): void {
  dns.lookup(hostname, options, (err: any, address: any, family: any) => {
    if (err) return callback(err, address, family);
    const list: Array<{ address: string }> = Array.isArray(address) ? address : [{ address }];
    if (list.some((entry) => isBlockedAddress(entry.address))) {
      return callback(new BlockedDestinationError(), undefined, undefined);
    }
    callback(null, address, family);
  });
}

export const guardedAgent = new Agent({ connect: { lookup: guardedLookup as any } });