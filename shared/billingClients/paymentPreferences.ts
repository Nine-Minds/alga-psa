/**
 * The fixed vocabularies behind a client's and a billing profile's payment
 * preferences: how they pay (preferred payment method) and when (payment
 * terms).
 *
 * One list, read by the client billing form, the billing profile settings,
 * server-side validation, due-date calculation, and invoice rendering, so the
 * client and its profiles cannot drift apart. Pure module with no server
 * imports — client components read it too.
 *
 * `clients.preferred_payment_method` and every `payment_terms` column are
 * unconstrained legacy text (the client form saves `''` when unset), so every
 * reader goes through the normalizers below rather than trusting the stored
 * string.
 */

export const PREFERRED_PAYMENT_METHODS = ['credit_card', 'bank_transfer', 'check'] as const;
export type PreferredPaymentMethod = (typeof PREFERRED_PAYMENT_METHODS)[number];

/**
 * Methods settled outside the online payment provider. An invoice whose
 * payment-method snapshot is one of these carries no "Pay now" link: the
 * customer was asked to pay another way.
 */
export const OFFLINE_PAYMENT_METHODS: ReadonlySet<PreferredPaymentMethod> = new Set([
  'bank_transfer',
  'check',
]);

/**
 * Authored English labels, used where a document is rendered without a
 * translator. UI surfaces translate through their own i18n keys.
 */
export const PREFERRED_PAYMENT_METHOD_LABELS: Record<PreferredPaymentMethod, string> = {
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  check: 'Check',
};

export const PAYMENT_TERMS = ['net_30', 'net_15', 'due_on_receipt'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

const PAYMENT_TERM_DAYS: Record<PaymentTerms, number> = {
  net_30: 30,
  net_15: 15,
  due_on_receipt: 0,
};

/** Terms applied when nothing (or nothing recognizable) is configured. */
export const DEFAULT_PAYMENT_TERMS: PaymentTerms = 'net_30';

export function isPreferredPaymentMethod(value: unknown): value is PreferredPaymentMethod {
  return typeof value === 'string' && (PREFERRED_PAYMENT_METHODS as readonly string[]).includes(value);
}

export function isPaymentTerms(value: unknown): value is PaymentTerms {
  return typeof value === 'string' && (PAYMENT_TERMS as readonly string[]).includes(value);
}

/** A stored method as a known key, or null for `''`, NULL, or legacy free text. */
export function normalizePreferredPaymentMethod(value: unknown): PreferredPaymentMethod | null {
  return isPreferredPaymentMethod(value) ? value : null;
}

/** Stored terms as a known key, or null for `''`, NULL, or legacy free text. */
export function normalizePaymentTerms(value: unknown): PaymentTerms | null {
  return isPaymentTerms(value) ? value : null;
}

/** The authored English label for a stored method, or null when it is not a known key. */
export function paymentMethodDisplayLabel(value: unknown): string | null {
  const method = normalizePreferredPaymentMethod(value);
  return method ? PREFERRED_PAYMENT_METHOD_LABELS[method] : null;
}

/** True when an invoice with this payment-method snapshot must not offer online payment. */
export function isOfflinePaymentMethod(value: unknown): boolean {
  const method = normalizePreferredPaymentMethod(value);
  return method !== null && OFFLINE_PAYMENT_METHODS.has(method);
}

/**
 * Days between invoice date and due date. Unknown or missing terms fall back
 * to Net 30, which is what due-date calculation has always done.
 */
export function paymentTermDays(value: unknown): number {
  return PAYMENT_TERM_DAYS[normalizePaymentTerms(value) ?? DEFAULT_PAYMENT_TERMS];
}
