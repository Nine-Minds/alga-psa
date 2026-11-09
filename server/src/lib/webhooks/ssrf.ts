import dns from 'node:dns/promises';
import { isIP } from 'node:net';

export { isGlobalUnicastAddress } from '../net/publicAddress';
import { isGlobalUnicastAddress } from '../net/publicAddress';

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
