import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isValidEmail } from '@alga-psa/core';

export type InvoiceBillingRecipientSource =
  | 'profile_billing_contact'
  | 'profile_billing_email'
  | 'profile_location'
  | 'billing_contact'
  | 'billing_email'
  | 'billing_location'
  | 'default_location'
  | 'none';

export interface InvoiceBillingRecipient {
  clientId: string;
  clientName: string;
  recipientEmail: string;
  recipientName: string;
  recipientSource: InvoiceBillingRecipientSource;
}

export interface ResolveInvoiceBillingRecipientInput {
  knexOrTrx: Knex | Knex.Transaction;
  tenantId: string;
  clientId: string;
  /**
   * The billing profile the invoice bills. A segmented client's profile — the
   * shape a merged-in client takes — carries its own AP contact and address,
   * and sending its invoice to the parent's inbox is the whole point of
   * segmenting. Omitted (or a profile with nothing filled in) falls straight
   * through to the client chain below, so an unsegmented client is untouched.
   */
  billingProfileId?: string | null;
}

/**
 * Resolves the billing-recipient email for an invoice with a single,
 * tenant-scoped precedence shared by email preview, direct delivery, scheduled
 * delivery, and Stripe customer creation:
 *
 *   0. The invoice's billing profile, when one was supplied: its billing
 *      contact, then its billing_email, then its bill-to location's email.
 *      Every profile field is nullable and NULL means "inherit", so a profile
 *      that sets nothing adds no step at all.
 *   1. Valid email on the active billing contact belonging to the client
 *      (clients.billing_contact_id).
 *   2. Valid clients.billing_email.
 *   3. Valid active billing-location email (is_billing_address = true),
 *      oldest created_at first with location_id as the stable tiebreaker.
 *   4. Valid active default-location email (is_default = true), using the
 *      same stable location ordering.
 *   5. No recipient.
 *
 * A billing contact row with a blank/invalid email never blocks the next
 * candidate. Every read is scoped to the supplied tenant.
 */
export async function resolveInvoiceBillingRecipient(
  input: ResolveInvoiceBillingRecipientInput
): Promise<InvoiceBillingRecipient> {
  const { knexOrTrx, tenantId, clientId, billingProfileId } = input;
  const db = tenantDb(knexOrTrx, tenantId);

  const trimmedIfValid = (email: string | null | undefined): string | null => {
    if (!isValidEmail(email)) return null;
    return (email as string).trim();
  };

  const firstValidLocationEmail = (
    locations: Array<{ email?: string | null }>
  ): string | null => {
    for (const location of locations) {
      const email = trimmedIfValid(location.email);
      if (email) return email;
    }
    return null;
  };

  const client = await db
    .table('clients')
    .where({ client_id: clientId })
    .select('client_id', 'client_name', 'billing_contact_id', 'billing_email')
    .first<{
      client_id: string;
      client_name: string;
      billing_contact_id?: string | null;
      billing_email?: string | null;
    }>();

  if (!client) {
    return {
      clientId,
      clientName: '',
      recipientEmail: '',
      recipientName: '',
      recipientSource: 'none',
    };
  }

  const contactEmailFor = async (
    contactNameId: string
  ): Promise<{ email: string; name: string | null } | null> => {
    const contact = await db
      .table('contacts')
      .where({ contact_name_id: contactNameId, client_id: client.client_id })
      .andWhere((qb) => {
        qb.where('is_inactive', false).orWhereNull('is_inactive');
      })
      .first<{ email?: string | null; full_name?: string | null }>();

    const email = trimmedIfValid(contact?.email);
    return email ? { email, name: contact?.full_name?.trim() || null } : null;
  };

  // The profile the invoice bills, when it carries its own AP identity.
  const profile = billingProfileId
    ? await db
        .table('client_billing_profiles')
        .where({ billing_profile_id: billingProfileId, client_id: client.client_id })
        .first<{
          bill_to_name?: string | null;
          billing_contact_id?: string | null;
          billing_email?: string | null;
          bill_to_location_id?: string | null;
        }>()
    : undefined;

  // The bill-to name is what the profile prints on the invoice, so it is also
  // who the invoice is addressed to; NULL keeps inheriting the client name.
  const recipientNameFallback = profile?.bill_to_name?.trim() || client.client_name;

  if (profile?.billing_contact_id) {
    const profileContact = await contactEmailFor(profile.billing_contact_id);
    if (profileContact) {
      return {
        clientId: client.client_id,
        clientName: client.client_name,
        recipientEmail: profileContact.email,
        recipientName: profileContact.name || recipientNameFallback,
        recipientSource: 'profile_billing_contact',
      };
    }
  }

  const profileBillingEmail = trimmedIfValid(profile?.billing_email);
  if (profileBillingEmail) {
    return {
      clientId: client.client_id,
      clientName: client.client_name,
      recipientEmail: profileBillingEmail,
      recipientName: recipientNameFallback,
      recipientSource: 'profile_billing_email',
    };
  }

  if (profile?.bill_to_location_id) {
    const billToLocation = await db
      .table('client_locations')
      .where({ location_id: profile.bill_to_location_id, client_id: client.client_id })
      .first<{ email?: string | null }>('email');

    const billToLocationEmail = trimmedIfValid(billToLocation?.email);
    if (billToLocationEmail) {
      return {
        clientId: client.client_id,
        clientName: client.client_name,
        recipientEmail: billToLocationEmail,
        recipientName: recipientNameFallback,
        recipientSource: 'profile_location',
      };
    }
  }

  if (client.billing_contact_id) {
    const billingContact = await contactEmailFor(client.billing_contact_id);
    if (billingContact) {
      return {
        clientId: client.client_id,
        clientName: client.client_name,
        recipientEmail: billingContact.email,
        recipientName: billingContact.name || recipientNameFallback,
        recipientSource: 'billing_contact',
      };
    }
  }

  const billingEmail = trimmedIfValid(client.billing_email);
  if (billingEmail) {
    return {
      clientId: client.client_id,
      clientName: client.client_name,
      recipientEmail: billingEmail,
      recipientName: recipientNameFallback,
      recipientSource: 'billing_email',
    };
  }

  const billingLocations = await db
    .table('client_locations')
    .where({ client_id: clientId, is_billing_address: true, is_active: true })
    .select<{ email?: string | null }[]>('email')
    .orderBy('created_at', 'asc')
    .orderBy('location_id', 'asc');

  const billingLocationEmail = firstValidLocationEmail(billingLocations);
  if (billingLocationEmail) {
    return {
      clientId: client.client_id,
      clientName: client.client_name,
      recipientEmail: billingLocationEmail,
      recipientName: recipientNameFallback,
      recipientSource: 'billing_location',
    };
  }

  const defaultLocations = await db
    .table('client_locations')
    .where({ client_id: clientId, is_default: true, is_active: true })
    .select<{ email?: string | null }[]>('email')
    .orderBy('created_at', 'asc')
    .orderBy('location_id', 'asc');

  const defaultLocationEmail = firstValidLocationEmail(defaultLocations);
  if (defaultLocationEmail) {
    return {
      clientId: client.client_id,
      clientName: client.client_name,
      recipientEmail: defaultLocationEmail,
      recipientName: recipientNameFallback,
      recipientSource: 'default_location',
    };
  }

  return {
    clientId: client.client_id,
    clientName: client.client_name,
    recipientEmail: '',
    recipientName: recipientNameFallback,
    recipientSource: 'none',
  };
}
