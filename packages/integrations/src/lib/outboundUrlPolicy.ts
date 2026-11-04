import {
  assertPublicHttpsUrl,
  isPublicAddress,
  postSafeOutboundForm as postCoreSafeOutboundForm,
  UnsafeUrlError,
} from '@alga-psa/core/net/safeFetch';

// Keep the integration-facing name while using the common core network policy.
export { UnsafeUrlError as UnsafeOutboundUrlError };

export function isBlockedOutboundAddress(address: string): boolean {
  return !isPublicAddress(address);
}

/** Validate and resolve a stored OAuth endpoint through the shared core policy. */
export async function resolveSafeOutboundUrl(rawUrl: string): Promise<{ url: URL; addresses: string[] }> {
  const target = await assertPublicHttpsUrl(rawUrl);
  return { url: target.url, addresses: [target.address] };
}

export async function assertSafeOutboundUrl(rawUrl: string): Promise<void> {
  await assertPublicHttpsUrl(rawUrl);
}

/** Shared safe form POST for integration callers that predate the core import. */
export async function postSafeOutboundForm<T = unknown>(
  rawUrl: string,
  body: URLSearchParams,
): Promise<{ status: number; data: T }> {
  return postCoreSafeOutboundForm<T>(rawUrl, body);
}
