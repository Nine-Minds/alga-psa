/** Keep the opaque UniFi host ID intact; only the final colon separates the site ID. */
export function parseUniFiScopeKey(scopeKey: string): { hostId: string; siteId: string } | null {
  const index = scopeKey.lastIndexOf(':');
  if (index <= 0 || index === scopeKey.length - 1) return null;
  return { hostId: scopeKey.slice(0, index), siteId: scopeKey.slice(index + 1) };
}
