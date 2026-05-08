import dns from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blockedAddresses = new BlockList();

blockedAddresses.addSubnet('10.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('172.16.0.0', 12, 'ipv4');
blockedAddresses.addSubnet('192.168.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('127.0.0.0', 8, 'ipv4');
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4');
blockedAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
blockedAddresses.addAddress('::1', 'ipv6');
blockedAddresses.addSubnet('fe80::', 10, 'ipv6');

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

function assertSafeResolvedAddress(address: string): void {
  const family = isIP(address);
  if (!family) {
    throw new UnsafeWebhookTargetError(
      `Webhook target resolved to a non-IP address: ${address}`,
    );
  }

  const type = family === 6 ? 'ipv6' : 'ipv4';
  if (blockedAddresses.check(address, type)) {
    throw new UnsafeWebhookTargetError(
      `Webhook target resolved to a blocked private address: ${address}`,
    );
  }
}

async function resolveAddresses(hostname: string): Promise<string[]> {
  if (isIP(hostname)) {
    return [hostname];
  }

  const results = await dns.lookup(hostname, {
    all: true,
    verbatim: true,
  });

  return results.map((result) => result.address);
}

export async function assertSafeWebhookTarget(targetUrl: string): Promise<void> {
  if (isPrivateTargetAllowed()) {
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(targetUrl);
  } catch {
    throw new UnsafeWebhookTargetError(`Webhook target URL is invalid: ${targetUrl}`);
  }

  assertSupportedScheme(parsedUrl.protocol);

  const hostname = normalizeHostname(parsedUrl.hostname);
  assertNotLocalhost(hostname);

  const addresses = await resolveAddresses(hostname);
  if (addresses.length === 0) {
    throw new UnsafeWebhookTargetError(
      `Webhook target hostname ${hostname} did not resolve`,
    );
  }

  for (const address of addresses) {
    assertSafeResolvedAddress(address);
  }
}
