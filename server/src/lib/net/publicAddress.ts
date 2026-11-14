import { isIP } from 'node:net';

type Ipv4Range = readonly [string, number];
const NON_GLOBAL_IPV4_RANGES: readonly Ipv4Range[] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
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

function parseIpv6(address: string): bigint | null {
  let text = address.split('%')[0]!;
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
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function ipv6InPrefix(value: bigint, prefix: string, prefixLen: number): boolean {
  const base = parseIpv6(prefix);
  return base !== null && value >> BigInt(128 - prefixLen) === base >> BigInt(128 - prefixLen);
}

const NON_GLOBAL_IPV6_RANGES = [
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
] as const;

/** True only for globally routable unicast addresses; malformed or special-use addresses fail closed. */
export function isGlobalUnicastAddress(address: string): boolean {
  const normalized = address.trim().replace(/^\[/, '').replace(/\]$/, '');
  const family = isIP(normalized.split('%')[0]);
  if (family === 4) {
    const value = parseIpv4(normalized);
    return value !== null && !NON_GLOBAL_IPV4_INTS.some(({ base, size }) => value >= base && value < base + size);
  }
  if (family !== 6) return false;
  const value = parseIpv6(normalized);
  if (value === null) return false;
  // IPv4-mapped and deprecated IPv4-compatible forms inherit IPv4 policy.
  if (value >> 32n === 0xffffn || value >> 32n === 0n) {
    const v4 = Number(value & 0xffffffffn);
    return !NON_GLOBAL_IPV4_INTS.some(({ base, size }) => v4 >= base && v4 < base + size);
  }
  if (ipv6InPrefix(value, '64:ff9b::', 96) || !ipv6InPrefix(value, '2000::', 3)) return false;
  return !NON_GLOBAL_IPV6_RANGES.some(([prefix, len]) => ipv6InPrefix(value, prefix, len));
}
