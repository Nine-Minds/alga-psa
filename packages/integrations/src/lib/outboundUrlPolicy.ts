/**
 * Outbound URL policy for server-initiated requests to tenant-supplied URLs
 * (e.g. IMAP OAuth token endpoints that receive refresh tokens / client secrets).
 *
 * Policy: https only, no userinfo, not localhost, and every resolved address
 * must be public (private, loopback, link-local, CGNAT, metadata, multicast and
 * reserved ranges are refused). Fails closed on DNS errors.
 */

// LEVERAGE: pattern outbound-url-policy — server/src/lib/net/safeFetch.ts (isBlockedAddress) and
// server/src/lib/webhooks/ssrf.ts each carry their own range lists; packages/ cannot import from
// server/, so this is a third copy. A shared packages/core layer should own the policy.

import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

export class UnsafeOutboundUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutboundUrlError';
  }
}

const blocked = new BlockList();
const v4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
for (const [net, prefix] of v4) blocked.addSubnet(net, prefix, 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');
blocked.addSubnet('64:ff9b::', 96, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');

function stripBrackets(host: string): string {
  return host.replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
}

/** True when a literal IP is in a range outbound requests must never reach. */
export function isBlockedOutboundAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family === 6) {
    // IPv4-mapped / compatible forms ("::ffff:169.254.169.254", "::ffff:a9fe:a9fe").
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
  return true; // not an IP -> fail closed
}

/**
 * Throws UnsafeOutboundUrlError unless `rawUrl` satisfies the outbound policy.
 * Message never includes the path or query.
 */
export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeOutboundUrlError('URL is invalid');
  }
  if (url.protocol !== 'https:') {
    throw new UnsafeOutboundUrlError('URL must use https');
  }
  if (url.username || url.password) {
    throw new UnsafeOutboundUrlError('URL must not contain credentials');
  }
  const host = stripBrackets(url.hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeOutboundUrlError('URL host is not permitted');
  }

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      const results = await dns.lookup(host, { all: true, verbatim: true });
      addresses = results.map((r) => r.address);
    } catch {
      throw new UnsafeOutboundUrlError(`URL host ${host} could not be resolved`);
    }
  }
  if (addresses.length === 0) {
    throw new UnsafeOutboundUrlError(`URL host ${host} could not be resolved`);
  }
  if (addresses.some(isBlockedOutboundAddress)) {
    throw new UnsafeOutboundUrlError('URL host resolves to a non-public address');
  }
}
