/**
 * Public, unauthenticated quote review link placed in quote emails.
 *
 * Path: `/quote/<token>` (mirrors `/share/<token>`). The public route that
 * serves it is a separate card; it must match QUOTE_REVIEW_LINK_PATH_PREFIX.
 *
 * The origin comes from `buildTenantPortalUrl`, so it is the tenant's active
 * custom portal domain when there is one, else the configured public base URL
 * (null when neither exists). Never log the returned URL: it contains the raw token.
 */
import { buildTenantPortalUrl } from '@alga-psa/tenancy/server';

export const QUOTE_REVIEW_LINK_PATH_PREFIX = '/quote';

async function buildOrNull(tenant: string, path: string): Promise<string | null> {
  try {
    return (await buildTenantPortalUrl(tenant, path)) ?? null;
  } catch {
    // A link lookup must never block sending the quote itself.
    return null;
  }
}

/** Absolute review URL for a raw token, or null when the tenant has no public origin. */
export async function buildQuoteReviewLink(tenant: string, token: string): Promise<string | null> {
  return buildOrNull(tenant, `${QUOTE_REVIEW_LINK_PATH_PREFIX}/${encodeURIComponent(token)}`);
}

/** Whether a review URL can be built for this tenant; checked before any token is minted. */
export async function canBuildQuoteReviewLink(tenant: string): Promise<boolean> {
  return (await buildOrNull(tenant, QUOTE_REVIEW_LINK_PATH_PREFIX)) !== null;
}
