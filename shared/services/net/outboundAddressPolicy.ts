import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

// LEVERAGE: pattern outbound-url-policy — server safeFetch and webhook SSRF policy still duplicate address ranges.

export class UnsafeOutboundAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutboundAddressError';
  }
}
export class UnsafeOutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutboundUrlError';
  }
}

const blocked = new BlockList();
const v4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
];
for (const [network, prefix] of v4) blocked.addSubnet(network, prefix, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');
blocked.addSubnet('64:ff9b::', 96, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');

export function isBlockedOutboundAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
    if (mapped) return blocked.check(mapped[1]!, 'ipv4');
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
    }
    return blocked.check(address, 'ipv6');
  }
  return true;
}

export function normalizeOutboundHostname(rawHost: string): string {
  return rawHost.replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

export async function assertSafeOutboundHost(rawHost: string): Promise<void> {
  const host = normalizeOutboundHostname(rawHost.trim());
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeOutboundAddressError('Host is not permitted');
  }
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await dns.lookup(host, { all: true, verbatim: true })).map(({ address }) => address);
    } catch {
      throw new UnsafeOutboundAddressError(`Host ${host} could not be resolved`);
    }
  }
  if (addresses.length === 0) throw new UnsafeOutboundAddressError(`Host ${host} could not be resolved`);
  if (addresses.some(isBlockedOutboundAddress)) {
    throw new UnsafeOutboundAddressError('Host resolves to a non-public address');
  }
}

export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeOutboundUrlError('URL is invalid');
  }
  if (url.protocol !== 'https:') throw new UnsafeOutboundUrlError('URL must use https');
  if (url.username || url.password) throw new UnsafeOutboundUrlError('URL must not contain credentials');
  try {
    await assertSafeOutboundHost(url.hostname);
  } catch (error) {
    if (error instanceof UnsafeOutboundAddressError) throw new UnsafeOutboundUrlError(error.message);
    throw error;
  }
}
