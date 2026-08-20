import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ensureClientDefaultBillingProfile } from './billingProfiles';

/**
 * A billing profile's effective billing settings, with client fallback (F087).
 *
 * Every profile-level field is nullable and NULL means **inherit from the
 * client**. That is what makes the backward-compatibility gate hold: a profile
 * with nothing filled in behaves exactly as the client does today, so a
 * single-profile client's invoice cannot move.
 *
 * Resolution is a per-field `??`, not an object-level "use the profile if it
 * has any values". An MSP that sets only a profile's PO number must keep
 * inheriting the client's bill-to name, delivery method, and payment terms —
 * an all-or-nothing switch would silently blank the rest.
 */

export interface EffectiveBillingIdentity {
  billingProfileId: string;
  /** Name to print as the bill-to. */
  billToName: string;
  billToLocationId: string | null;
  billingContactId: string | null;
  billingEmail: string | null;
  /** Tax identity — region is deliberately absent; profiles do not affect it. */
  isTaxExempt: boolean;
  taxExemptionCertificate: string | null;
  taxIdNumber: string | null;
  poNumber: string | null;
  poRequired: boolean;
  invoiceDeliveryMethod: string | null;
  invoiceTemplateId: string | null;
  billingCycle: string | null;
  paymentTerms: string | null;
  /** True when this profile produces its own invoice document (phase 2). */
  billsSeparately: boolean;
  /** Which fields came from the profile rather than the client. */
  overriddenFields: string[];
}

const PROFILE_COLUMNS = [
  'billing_profile_id',
  'name',
  'bills_separately',
  'bill_to_name',
  'bill_to_location_id',
  'billing_contact_id',
  'billing_email',
  'is_tax_exempt',
  'tax_exemption_certificate',
  'tax_id_number',
  'po_number',
  'po_required',
  'invoice_delivery_method',
  'invoice_template_id',
  'billing_cycle',
  'payment_terms',
];

const CLIENT_COLUMNS = [
  'client_name',
  'billing_contact_id',
  'billing_email',
  'is_tax_exempt',
  'tax_exemption_certificate',
  'tax_id_number',
  'invoice_delivery_method',
  'invoice_template_id',
  'billing_cycle',
  'payment_terms',
];

export async function resolveEffectiveBillingIdentity(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
  billingProfileId?: string | null,
): Promise<EffectiveBillingIdentity> {
  const db = tenantDb(knex, tenant);
  const resolvedProfileId =
    billingProfileId ?? (await ensureClientDefaultBillingProfile(knex, tenant, clientId));

  const [profile, client] = await Promise.all([
    db
      .table('client_billing_profiles')
      .where({ billing_profile_id: resolvedProfileId })
      .first(...PROFILE_COLUMNS),
    db.table('clients').where({ client_id: clientId }).first(...CLIENT_COLUMNS),
  ]);

  if (!profile) {
    throw new Error(`Billing profile ${resolvedProfileId} not found in tenant ${tenant}.`);
  }
  if (!client) {
    throw new Error(`Client ${clientId} not found in tenant ${tenant}.`);
  }

  const overriddenFields: string[] = [];
  const inherit = <T>(field: string, profileValue: T | null | undefined, clientValue: T): T => {
    if (profileValue !== null && profileValue !== undefined) {
      overriddenFields.push(field);
      return profileValue;
    }
    return clientValue;
  };

  return {
    billingProfileId: resolvedProfileId,
    // A profile's own bill-to name falls back to the *client* name, not the
    // profile name: the profile name is an internal label ("North Plant"), not
    // something to print on an invoice unless someone chose it.
    billToName: inherit('bill_to_name', profile.bill_to_name, client.client_name),
    billToLocationId: profile.bill_to_location_id ?? null,
    billingContactId: inherit(
      'billing_contact_id',
      profile.billing_contact_id,
      client.billing_contact_id ?? null,
    ),
    billingEmail: inherit('billing_email', profile.billing_email, client.billing_email ?? null),
    isTaxExempt: inherit('is_tax_exempt', profile.is_tax_exempt, Boolean(client.is_tax_exempt)),
    taxExemptionCertificate: inherit(
      'tax_exemption_certificate',
      profile.tax_exemption_certificate,
      client.tax_exemption_certificate ?? null,
    ),
    taxIdNumber: inherit('tax_id_number', profile.tax_id_number, client.tax_id_number ?? null),
    poNumber: profile.po_number ?? null,
    poRequired: profile.po_required ?? false,
    invoiceDeliveryMethod: inherit(
      'invoice_delivery_method',
      profile.invoice_delivery_method,
      client.invoice_delivery_method ?? null,
    ),
    invoiceTemplateId: inherit(
      'invoice_template_id',
      profile.invoice_template_id,
      client.invoice_template_id ?? null,
    ),
    billingCycle: inherit('billing_cycle', profile.billing_cycle, client.billing_cycle ?? null),
    paymentTerms: inherit('payment_terms', profile.payment_terms, client.payment_terms ?? null),
    billsSeparately: Boolean(profile.bills_separately),
    overriddenFields,
  };
}

/**
 * Profiles of a client that bill separately — each produces its own invoice
 * document, its own cycle, and its own AR balance (phase 2).
 *
 * A client with none of these behaves exactly as it does today: one invoice per
 * cycle for the whole client.
 */
export async function listSeparatelyBillingProfiles(
  knex: Knex | Knex.Transaction,
  tenant: string,
  clientId: string,
): Promise<Array<{ billing_profile_id: string; name: string; billing_cycle: string | null }>> {
  return tenantDb(knex, tenant)
    .table('client_billing_profiles')
    .where({ client_id: clientId, is_active: true, bills_separately: true })
    .orderBy('name', 'asc')
    .select('billing_profile_id', 'name', 'billing_cycle');
}
