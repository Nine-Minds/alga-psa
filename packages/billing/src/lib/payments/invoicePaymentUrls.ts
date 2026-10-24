/**
 * Worker-safe builders for the public invoice URLs placed in emails (portal
 * invoices URL and durable `/pay/<token>` URL). Deliberately NOT an action
 * module and free of `@alga-psa/auth` / `paymentActions`, so the Temporal
 * autopay worker can import it without loading session code.
 */

import logger from '@alga-psa/core/logger';
import { getPortalDomainStatusForTenant } from '@alga-psa/tenancy/lib/portalDomainStatus';
import { issuePaymentLinkToken } from './paymentLinkToken';

/**
 * The public origin for links sent to customers: active tenant vanity domain
 * first, then the env fallbacks. Null when no valid http(s) base exists.
 */
async function resolvePublicBaseUrl(tenantId: string): Promise<URL | null> {
  let vanityBaseUrl = '';
  try {
    const portalDomain = await getPortalDomainStatusForTenant(tenantId);
    if (portalDomain.status === 'active' && portalDomain.domain) {
      vanityBaseUrl = `https://${portalDomain.domain}`;
    }
  } catch (error) {
    logger.warn('[billing/invoicePaymentUrls] Failed to resolve custom portal domain', {
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const baseUrl =
    vanityBaseUrl ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.HOST ? `https://${process.env.HOST}` : '');

  if (!baseUrl) return null;

  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    logger.warn('[billing/invoicePaymentUrls] Invalid public base URL', { tenantId, baseUrl });
    return null;
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    return null;
  }
  return base;
}

/**
 * Builds the authenticated client-portal invoices URL for an invoice,
 * preferring an active tenant vanity domain, then the configured public app
 * URLs. Returns null when no valid public base exists (the portal CTA is
 * omitted from the email rather than leaking an internal worker hostname).
 */
export async function buildPortalInvoiceUrl(tenantId: string, invoiceId: string): Promise<string | null> {
  const base = await resolvePublicBaseUrl(tenantId);
  if (!base) return null;

  const url = new URL('/client-portal/billing', base);
  url.searchParams.set('tab', 'invoices');
  url.searchParams.set('invoiceId', invoiceId);
  return url.toString();
}

/**
 * Builds the durable public `/pay/<token>` URL on the same public base as the
 * portal URL. Null when no valid public base exists.
 */
export async function buildDurablePaymentUrl(
  tenantId: string,
  invoiceId: string,
  lifetimeHours: number,
): Promise<string | null> {
  const base = await resolvePublicBaseUrl(tenantId);
  if (!base) return null;
  const { token } = issuePaymentLinkToken({ tenantId, invoiceId, lifetimeHours });
  return new URL(`/pay/${token}`, base).toString();
}
