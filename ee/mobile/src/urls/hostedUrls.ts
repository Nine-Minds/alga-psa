export function buildHostedPathUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(normalizedPath, baseUrl).toString();
}

export function tryBuildHostedPathUrl(baseUrl: string | null, path: string): string | null {
  if (!baseUrl) return null;
  try {
    return buildHostedPathUrl(baseUrl, path);
  } catch {
    return null;
  }
}

export function buildTicketWebUrl(baseUrl: string, ticketId: string): string {
  const safeId = encodeURIComponent(ticketId);
  return buildHostedPathUrl(baseUrl, `/msp/tickets/${safeId}`);
}

