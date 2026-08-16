import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ensureClientDefaultBillingProfile } from './billingProfiles';

/**
 * Payment methods and AR, scoped to the billing profile that owns them
 * (slice S9, features F104–F106; slice S10, F111–F115).
 *
 * Decision D7 is the reason any of this exists: sibling profiles are separately
 * billed entities, routinely with different cards and different people
 * authorising them. A card on file for one franchise site paying another site's
 * invoice is not a convenience, it is an unauthorised charge — so the profile
 * travels with the payment method rather than being inferred at charge time.
 *
 * These helpers live in `shared/` because their callers are the client portal
 * and the public API service, neither of which should take a dependency on the
 * billing engine to honour a billing invariant.
 */

export const PAYMENT_METHODS_TABLE = 'payment_methods';

export interface PaymentMethodRow {
  payment_method_id: string;
  client_id: string;
  billing_profile_id: string;
  type: string;
  last4: string | null;
  exp_month: string | null;
  exp_year: string | null;
  is_default: boolean;
}

/**
 * The profile a payment method should be filed under.
 *
 * An explicit profile wins; otherwise the client's default profile, which is
 * what an unsegmented client has always meant. Callers that have an invoice in
 * hand should pass its profile (F106) rather than letting it fall through.
 */
export async function resolvePaymentBillingProfileId(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  requestedProfileId?: string | null,
): Promise<string> {
  if (requestedProfileId) {
    const profile = await tenantDb(knex, tenant)
      .table('client_billing_profiles')
      .where({ billing_profile_id: requestedProfileId, client_id: clientId })
      .first('billing_profile_id');
    if (!profile) {
      // Belonging to a *different* client is the case worth failing loudly on:
      // it would file a card under an entity that never authorised it.
      throw new Error(
        `Billing profile ${requestedProfileId} does not belong to client ${clientId}`,
      );
    }
    return profile.billing_profile_id as string;
  }
  return ensureClientDefaultBillingProfile(knex, tenant, clientId);
}

/**
 * A client's payment methods, optionally narrowed to one profile (F105).
 *
 * Without a profile this returns the whole client, which is both the
 * unsegmented case and the client-level rollup an internal AR view wants.
 */
export async function listPaymentMethods(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  billingProfileId?: string | null,
): Promise<PaymentMethodRow[]> {
  const query = tenantDb(knex, tenant)
    .table(PAYMENT_METHODS_TABLE)
    .where({ client_id: clientId, is_deleted: false });
  if (billingProfileId) {
    query.where({ billing_profile_id: billingProfileId });
  }
  return query
    .orderBy('is_default', 'desc')
    .orderBy('created_at', 'asc')
    .select(
      'payment_method_id',
      'client_id',
      'billing_profile_id',
      'type',
      'last4',
      'exp_month',
      'exp_year',
      'is_default',
    );
}

/**
 * Clear the current default for one profile only (F104).
 *
 * The pre-profile version of this cleared every card on the client, which after
 * segmentation would quietly strip a sibling entity of its default card as a
 * side effect of someone else changing theirs.
 */
export async function clearDefaultPaymentMethod(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  billingProfileId: string,
): Promise<void> {
  await tenantDb(knex, tenant)
    .table(PAYMENT_METHODS_TABLE)
    .where({ client_id: clientId, billing_profile_id: billingProfileId, is_deleted: false })
    .update({ is_default: false });
}

/**
 * The card to charge for an invoice (F106).
 *
 * An invoice belonging to a profile is charged to that profile's default card,
 * full stop — no fallback to a sibling's card, because paying one entity's bill
 * with another entity's card is the defect this slice exists to prevent.
 * Invoices that predate profiles carry no profile and fall back to the client's
 * default card, which is exactly what they have always been charged to.
 */
export async function getPaymentMethodForInvoice(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  invoiceBillingProfileId: string | null | undefined,
): Promise<PaymentMethodRow | null> {
  const query = tenantDb(knex, tenant)
    .table(PAYMENT_METHODS_TABLE)
    .where({ client_id: clientId, is_deleted: false, is_default: true });
  if (invoiceBillingProfileId) {
    query.where({ billing_profile_id: invoiceBillingProfileId });
  }
  const row = await query.first(
    'payment_method_id',
    'client_id',
    'billing_profile_id',
    'type',
    'last4',
    'exp_month',
    'exp_year',
    'is_default',
  );
  return (row as PaymentMethodRow | undefined) ?? null;
}
