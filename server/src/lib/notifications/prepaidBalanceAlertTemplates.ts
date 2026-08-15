/**
 * Notification definitions for prepaid balance alerts (task 29.8.20).
 *
 * The subtype/template rows themselves are seeded by the migration from the
 * shared template source of truth; this module centralizes the names and the
 * template context builders the server-side delivery layer uses. Values that
 * are locale/currency formatted (threshold, available, capacity, used) are
 * formatted by the caller before rendering.
 */

export const CREDIT_LOW_BALANCE_TEMPLATE = 'prepaid-credit-low-balance';
export const BUCKET_THRESHOLD_REACHED_TEMPLATE = 'prepaid-bucket-threshold-reached';
export const CREDIT_LOW_BALANCE_SUBTYPE = 'prepaid-credit-low-balance';
export const BUCKET_THRESHOLD_REACHED_SUBTYPE = 'prepaid-bucket-threshold-reached';

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

/** MSP navigation link for the account manager. */
export function managerAlertLink(clientId: string): string {
  return `${baseUrl()}/msp/clients/${clientId}?tab=billing`;
}

/** Client portal navigation link for the client billing recipient. */
export function clientAlertLink(): string {
  return `${baseUrl()}/client-portal/billing`;
}

export interface CreditAlertTemplateValues {
  currency: string;
  threshold: string;
  available: string;
  link: string;
}

export interface BucketAlertTemplateValues {
  percent: number;
  usedPercent: number;
  capacity: string;
  used: string;
  link: string;
}

/** Handlebars context for the credit email/internal template. */
export function buildCreditAlertContext(clientName: string, values: CreditAlertTemplateValues): Record<string, unknown> {
  return {
    client: { name: clientName },
    alert: {
      currency: values.currency,
      threshold: values.threshold,
      available: values.available,
      link: values.link,
    },
  };
}

/** Handlebars context for the bucket email/internal template. */
export function buildBucketAlertContext(clientName: string, values: BucketAlertTemplateValues): Record<string, unknown> {
  return {
    client: { name: clientName },
    alert: {
      percent: values.percent,
      usedPercent: values.usedPercent,
      capacity: values.capacity,
      used: values.used,
      link: values.link,
    },
  };
}

/**
 * Flat Handlebars context for the INTERNAL notification channel. The internal
 * renderer substitutes only top-level `\w+` keys (no dotted paths), so the
 * resulting keys must match the seeded internal template placeholders exactly
 * ({{clientName}}, {{available}}, {{currency}}, {{threshold}}, {{percent}},
 * {{usedPercent}}, {{capacity}}, {{used}}, {{link}}).
 */
export function buildInternalAlertContext(
  clientName: string,
  values: Record<string, string | number>
): Record<string, unknown> {
  return { clientName, ...values };
}
