import type Stripe from 'stripe';
import type { StripeCustomerSnapshot } from './stripeImportClassifier';

/**
 * SCA-risk heuristic (documented in the import preview):
 *
 * A card has "off-session evidence" when Stripe shows it was collected for
 * future off-session use, i.e. EITHER
 *   - a succeeded SetupIntent exists for it with usage = 'off_session'
 *     (Stripe's default usage, and what Checkout setup mode / Elements use), OR
 *   - a succeeded PaymentIntent exists for it with setup_future_usage = 'off_session'.
 *
 * Cards without either are imported but flagged `scaRisk`, because the issuer may demand
 * authentication on the first off-session charge. `allow_redisplay` is NOT evidence: it records
 * consent to re-show the card in a UI, not that the cardholder authenticated for off-session use.
 * `off_session: true` on a past PaymentIntent is a request parameter Stripe does not retain, so it
 * cannot be used either.
 */
export function offSessionEvidence(
  setupIntents: Array<Pick<Stripe.SetupIntent, 'status' | 'usage' | 'payment_method'>>,
  paymentIntents: Array<Pick<Stripe.PaymentIntent, 'status' | 'setup_future_usage' | 'payment_method'>>,
): Set<string> {
  const ids = new Set<string>();
  const idOf = (pm: unknown): string | null => (typeof pm === 'string' ? pm : (pm as { id?: string } | null)?.id ?? null);
  for (const setup of setupIntents) {
    const id = idOf(setup.payment_method);
    if (id && setup.status === 'succeeded' && setup.usage === 'off_session') ids.add(id);
  }
  for (const intent of paymentIntents) {
    const id = idOf(intent.payment_method);
    if (id && intent.status === 'succeeded' && intent.setup_future_usage === 'off_session') ids.add(id);
  }
  return ids;
}

export function toCustomerSnapshot(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
  paymentMethods: Stripe.PaymentMethod[],
  evidence: Set<string>,
): StripeCustomerSnapshot {
  if ('deleted' in customer && customer.deleted) {
    return { id: customer.id, deleted: true, email: null, name: null, currency: null, defaultPaymentMethodId: null, metadata: {}, paymentMethods: [] };
  }
  const live = customer as Stripe.Customer;
  const defaultPm = live.invoice_settings?.default_payment_method;
  return {
    id: live.id,
    email: live.email ?? null,
    name: live.name ?? null,
    currency: live.currency ?? null,
    defaultPaymentMethodId: typeof defaultPm === 'string' ? defaultPm : defaultPm?.id ?? null,
    metadata: { ...(live.metadata ?? {}) },
    paymentMethods: paymentMethods.map((pm) => ({
      id: pm.id,
      type: pm.type,
      created: pm.created,
      card: pm.type === 'card' && pm.card
        ? { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year, fingerprint: pm.card.fingerprint ?? null }
        : undefined,
      allowRedisplay: (pm as { allow_redisplay?: string }).allow_redisplay ?? null,
      metadata: { ...(pm.metadata ?? {}) },
      offSessionEvidence: evidence.has(pm.id),
    })),
  };
}
