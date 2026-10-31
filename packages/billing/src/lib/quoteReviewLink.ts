/**
 * Public, unauthenticated quote review link placed in quote emails.
 *
 * Path: `/quote/<token>` (mirrors `/share/<token>`). The public route that
 * serves it is a separate card; it must match QUOTE_REVIEW_LINK_PATH_PREFIX.
 *
 * The origin is the app's public base URL, deliberately NOT the tenant's
 * custom portal domain (that applies only to the secondary client-portal
 * link). Never log the returned URL: it contains the raw token.
 */

export const QUOTE_REVIEW_LINK_PATH_PREFIX = '/quote';

function parseHttpOrigin(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Same public base URL source as /share links: NEXT_PUBLIC_BASE_URL, NEXTAUTH_URL, https://$HOST. */
export function getPublicBaseOrigin(): string | null {
  const candidates = [
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.NEXTAUTH_URL,
    process.env.HOST ? `https://${process.env.HOST}` : undefined,
  ];
  for (const candidate of candidates) {
    const origin = parseHttpOrigin(candidate);
    if (origin) return origin;
  }
  return null;
}

/** Absolute review URL for a raw token, or null when no public origin is configured. */
export function buildQuoteReviewLink(token: string): string | null {
  const origin = getPublicBaseOrigin();
  if (!origin) return null;
  return `${origin}${QUOTE_REVIEW_LINK_PATH_PREFIX}/${encodeURIComponent(token)}`;
}
