import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { domainToASCII } from 'node:url';

/**
 * Shared validate-then-connect policy for URLs that cause server-side network
 * activity. Callers must still prevent redirects and account for DNS rebinding.
 */
export class UnsafeOutboundTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeOutboundTargetError';
  }
}

export type OutboundTargetOptions = {
  schemes: readonly string[];
  /** Exact hosts/IPs allowed to resolve to private addresses. Never tenant data. */
  privateTargetAllowlist?: readonly string[];
  /** Deployment-owned compatibility switch; still enforces URL syntax/scheme. */
  allowPrivateTargets?: boolean;
  /** Injection point for deterministic tests. */
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
};

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(network, prefix, 'ipv4');
blocked.addAddress('255.255.255.255', 'ipv4');
for (const [network, prefix] of [
  ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(network, prefix, 'ipv6');
const allowlistEligiblePrivate = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
] as const) allowlistEligiblePrivate.addSubnet(network, prefix, 'ipv4');
allowlistEligiblePrivate.addSubnet('fc00::', 7, 'ipv6');

function normalizeHostname(hostname: string): string {
  const unwrapped = hostname.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '').toLowerCase();
  return isIP(unwrapped) ? unwrapped : domainToASCII(unwrapped);
}

function ipv4FromMappedIpv6(address: string): string | undefined {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  const dottedAddress = match?.[1];
  if (dottedAddress && isIP(dottedAddress) === 4) return dottedAddress;
  const hex = /^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/i.exec(address);
  const highHex = hex?.[1];
  const lowHex = hex?.[2];
  if (!highHex || !lowHex) return undefined;
  const high = parseInt(highHex, 16), low = parseInt(lowHex, 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function isBlockedOutboundAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, 'ipv4');
  if (family !== 6) return true;
  const mapped = ipv4FromMappedIpv6(address);
  if (mapped) return blocked.check(mapped, 'ipv4');
  return blocked.check(address, 'ipv6');
}

function isPrivateRangeEligibleForAllowlist(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return allowlistEligiblePrivate.check(address, 'ipv4');
  if (family !== 6) return false;
  const mapped = ipv4FromMappedIpv6(address);
  if (mapped) return allowlistEligiblePrivate.check(mapped, 'ipv4');
  return allowlistEligiblePrivate.check(address, 'ipv6');
}

function normalizeAllowlist(allowlist: readonly string[]): Set<string> {
  return new Set(allowlist.map(normalizeHostname).filter(Boolean));
}

/** Parse, validate scheme/host, resolve every answer, and reject unsafe answers. */
export async function assertSafeOutboundTarget(
  targetUrl: string,
  options: OutboundTargetOptions,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new UnsafeOutboundTargetError(`Outbound target URL is invalid: ${targetUrl}`);
  }
  const schemes = options.schemes.map((scheme) => scheme.endsWith(':') ? scheme : `${scheme}:`);
  if (!schemes.includes(parsed.protocol)) {
    throw new UnsafeOutboundTargetError(`Outbound target protocol ${parsed.protocol} is not allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeOutboundTargetError('Outbound target URL must not contain credentials');
  }
  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || hostname.includes('%') || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeOutboundTargetError(`Outbound target hostname ${hostname || parsed.hostname} is not allowed`);
  }
  const lookup = options.lookup ?? ((host: string) => dns.lookup(host, { all: true, verbatim: true }));
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname);
  } catch {
    throw new UnsafeOutboundTargetError(`Outbound target hostname ${hostname} did not resolve`);
  }
  if (!addresses.length) throw new UnsafeOutboundTargetError(`Outbound target hostname ${hostname} did not resolve`);
  const allowedPrivateHosts = normalizeAllowlist(options.privateTargetAllowlist ?? []);
  for (const { address } of addresses) {
    const blockedAddress = isBlockedOutboundAddress(address);
    const allowlistedPrivate = allowedPrivateHosts.has(hostname) && isPrivateRangeEligibleForAllowlist(address);
    if (blockedAddress && !options.allowPrivateTargets && !allowlistedPrivate) {
      throw new UnsafeOutboundTargetError(`Outbound target resolved to a blocked private address: ${address}`);
    }
  }
  return parsed;
}

/** Exact hostname/IP allowlist parser used by deployment-owned policy. */
export function parseOutboundTargetAllowlist(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const normalized = entries.map(normalizeHostname);
  const invalid = normalized.some((entry, index) => {
    const original = entries[index];
    if (original === undefined) return true;
    if (/[\\/*?#@%]/.test(original)) return true;
    if (!entry || entry === 'localhost' || entry.endsWith('.localhost')) return true;
    if (isIP(entry)) return false;
    if (original.includes(':')) return true;
    if (entry.length > 253) return true;
    return entry.split('.').some((label) =>
      label.length === 0 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    );
  });
  if (invalid) {
    throw new Error('EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST contains an invalid hostname');
  }
  return normalized;
}
