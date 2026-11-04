/**
 * Worker-safe builders for the public invoice URLs placed in emails (portal
 * invoices URL and durable `/pay/<token>` URL). Deliberately NOT an action
 * module and free of `@alga-psa/auth` / `paymentActions`, so the Temporal
 * autopay worker can import it without loading session code.
 */

import { buildTenantPortalUrl, getTenantPortalBaseUrl } from '@alga-psa/tenancy/lib/tenantPortalUrl';
import { issuePaymentLinkToken } from './paymentLinkToken';

/**
 * Builds the authenticated client-portal invoices URL for an invoice on the
 * tenant's portal origin (active vanity domain, then the configured public app
 * URLs). Returns null when no valid public base exists (the portal CTA is
 * omitted from the email rather than leaking an internal worker hostname).
 */
export async function buildPortalInvoiceUrl(tenantId: string, invoiceId: string): Promise<string | null> {
  return buildTenantPortalUrl(tenantId, '/client-portal/billing', { tab: 'invoices', invoiceId });
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
  const origin = await getTenantPortalBaseUrl(tenantId);
  if (!origin) return null;
  const { token } = issuePaymentLinkToken({ tenantId, invoiceId, lifetimeHours });
  return new URL(`/pay/${token}`, origin).toString();
}
