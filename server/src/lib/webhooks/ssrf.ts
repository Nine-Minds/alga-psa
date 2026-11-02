import dns from 'node:dns/promises';
import { isIP } from 'node:net';

// Address policy is an allow rule: only global unicast addresses may be contacted.
// Tables follow the IANA special-purpose address registries:
//   IPv4: https://www.iana.org/assignments/iana-ipv4-special-registry
//   IPv6: https://www.iana.org/assignments/iana-ipv6-special-registry
//   IPv6 unicast allocation: https://www.iana.org/assignments/ipv6-unicast-address-assignments
type Ipv4Range = readonly [string, number];

const NON_GLOBAL_IPV4_RANGES: readonly Ipv4Range[] = [
  ['0.0.0.0', 8], // "this network" (reaches loopback listeners on Linux)
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255 broadcast
];

function parseIpv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const NON_GLOBAL_IPV4_INTS = NON_GLOBAL_IPV4_RANGES.map(([base, prefix]) => ({
  base: parseIpv4(base) as number,
  size: 2 ** (32 - prefix),
}));

function isGlobalIpv4(value: number): boolean {
  return !NON_GLOBAL_IPV4_INTS.some(({ base, size }) => value >= base && value < base + size);
}

function parseIpv6(address: string): bigint | null {
  let text = address.split('%')[0];
  const lastColon = text.lastIndexOf(':');
  if (text.includes('.')) {
    const v4 = parseIpv4(text.slice(lastColon + 1));
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  let value = BigInt(0);
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << BigInt(16)) | BigInt(parseInt(group, 16));
  }
  return value;
}

function ipv6InPrefix(value: bigint, prefixHex: string, prefixLen: number): boolean {
  const base = parseIpv6(prefixHex) as bigint;
  const shift = BigInt(128 - prefixLen);
  return value >> shift === base >> shift;
}

// Only 2000::/3 is allocated for global unicast; everything else (::/8, fc00::/7,
// fe80::/10, ff00::/8, 100::/64, ...) is rejected by that containment alone.
// These are the special-purpose carve-outs inside 2000::/3.
const NON_GLOBAL_IPV6_RANGES: readonly Ipv6Range[] = [
  ['2001::', 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID, ...)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embedded IPv4 is attacker-chosen; reject)
  ['3fff::', 20], // documentation (RFC 9637)
];
type Ipv6Range = readonly [string, number];

/**
 * True only for addresses that are globally routable unicast. IPv4-mapped
 * (::ffff:a.b.c.d / ::ffff:7f00:1) and IPv4-compatible (::a.b.c.d) IPv6 forms
 * are judged on their embedded IPv4 address. Unparseable input is rejected.
 */
export function isGlobalUnicastAddress(address: string): boolean {
  const normalized = address.trim().replace(/^\[/, '').replace(/\]$/, '');
  const family = isIP(normalized.split('%')[0]);
  if (family === 4) {
    const v4 = parseIpv4(normalized);
    return v4 !== null && isGlobalIpv4(v4);
  }
  if (family !== 6) return false;

  const value = parseIpv6(normalized);
  if (value === null) return false;

  const low32 = Number(value & BigInt(0xffffffff));
  // ::ffff:0:0/96 (mapped) and ::/96 (deprecated compatible, includes :: and ::1)
  if (value >> BigInt(32) === BigInt(0xffff) || value >> BigInt(32) === BigInt(0)) {
    return isGlobalIpv4(low32);
  }
  // 64:ff9b::/96 NAT64 well-known prefix: translates to arbitrary IPv4, reject.
  if (ipv6InPrefix(value, '64:ff9b::', 96)) return false;
  if (!ipv6InPrefix(value, '2000::', 3)) return false;
  return !NON_GLOBAL_IPV6_RANGES.some(([prefix, len]) => ipv6InPrefix(value, prefix, len));
}

export class UnsafeWebhookTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebhookTargetError';
  }
}

function isPrivateTargetAllowed(): boolean {
  return process.env.WEBHOOK_SSRF_ALLOW_PRIVATE === 'true';
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function assertSupportedScheme(protocol: string): void {
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new UnsafeWebhookTargetError(
      `Webhook target protocol ${protocol} is not allowed`,
    );
  }
}

function assertNotLocalhost(hostname: string): void {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeWebhookTargetError(
      `Webhook target hostname ${hostname} resolves to a local address`,
    );
  }
}

export type AddressPolicy = (address: string) => boolean;

export function assertSafeResolvedAddress(
  address: string,
  isAddressAllowed: AddressPolicy = isGlobalUnicastAddress,
): void {
  if (!isIP(address)) {
    throw new UnsafeWebhookTargetError(
      `Webhook target resolved to a non-IP address: ${address}`,
    );
  }

  if (!isAddressAllowed(address)) {
    throw new UnsafeWebhookTargetError(
      `Webhook target resolved to a blocked non-public address: ${address}`,
    );
  }
}

export function isPrivateWebhookTargetAllowed(): boolean {
  return isPrivateTargetAllowed();
}

/**
 * Resolve a hostname and require every returned address to pass the policy.
 * Used both by the pre-flight check and by the connect-time lookup that pins
 * the socket to the validated addresses.
 */
export async function resolveValidatedAddresses(
  hostname: string,
  isAddressAllowed: AddressPolicy = isGlobalUnicastAddress,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const addresses = isIP(hostname)
    ? [hostname]
    : (await dns.lookup(hostname, { all: true, verbatim: true })).map((r) => r.address);

  if (addresses.length === 0) {
    throw new UnsafeWebhookTargetError(`Webhook target hostname ${hostname} did not resolve`);
  }
  for (const address of addresses) {
    assertSafeResolvedAddress(address, isAddressAllowed);
  }
  return addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
}

/**
 * Synchronous checks that need no DNS: scheme, localhost names and IP-literal
 * hosts. Node never calls `lookup` for IP literals, so this is the only gate
 * for them and must run before every connection.
 */
export function assertSafeWebhookUrl(
  target: string | URL,
  isAddressAllowed: AddressPolicy = isGlobalUnicastAddress,
): URL {
  let parsedUrl: URL;
  try {
    parsedUrl = typeof target === 'string' ? new URL(target) : target;
  } catch {
    throw new UnsafeWebhookTargetError(`Webhook target URL is invalid: ${target}`);
  }

  assertSupportedScheme(parsedUrl.protocol);
  const hostname = normalizeHostname(parsedUrl.hostname);
  assertNotLocalhost(hostname);
  if (isIP(hostname)) {
    assertSafeResolvedAddress(hostname, isAddressAllowed);
  }
  return parsedUrl;
}

export async function assertSafeWebhookTarget(
  targetUrl: string,
  isAddressAllowed: AddressPolicy = isGlobalUnicastAddress,
): Promise<void> {
  if (isPrivateTargetAllowed()) {
    return;
  }

  const parsedUrl = assertSafeWebhookUrl(targetUrl, isAddressAllowed);
  await resolveValidatedAddresses(normalizeHostname(parsedUrl.hostname), isAddressAllowed);
}
