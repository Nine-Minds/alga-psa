import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isValidEmail } from '@alga-psa/core';

export type InvoiceBillingRecipientSource =
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
}

/**
 * Resolves the billing-recipient email for an invoice's client with a single,
 * tenant-scoped precedence shared by email preview, direct delivery, scheduled
 * delivery, and Stripe customer creation:
 *
 *   1. Valid email on the billing contact (clients.billing_contact_id).
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
  const { knexOrTrx, tenantId, clientId } = input;
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

  if (client.billing_contact_id) {
    const contact = await db
      .table('contacts')
      .where({ contact_name_id: client.billing_contact_id })
      .first<{ email?: string | null; full_name?: string | null }>();

    const contactEmail = trimmedIfValid(contact?.email);
    if (contactEmail) {
      return {
        clientId: client.client_id,
        clientName: client.client_name,
        recipientEmail: contactEmail,
        recipientName: contact.full_name?.trim() || client.client_name,
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
      recipientName: client.client_name,
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
      recipientName: client.client_name,
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
      recipientName: client.client_name,
      recipientSource: 'default_location',
    };
  }

  return {
    clientId: client.client_id,
    clientName: client.client_name,
    recipientEmail: '',
    recipientName: client.client_name,
    recipientSource: 'none',
  };
}
