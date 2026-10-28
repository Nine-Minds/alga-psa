import type { Knex } from 'knex';
import { resolveInvoiceBillingRecipient } from '../../services/invoiceBillingRecipientService';

/**
 * The email an accounting export should attach to each invoice's customer:
 * the same address the invoice itself is emailed to, resolved per billing
 * profile (a separately-billing site carries its own AP inbox) and falling
 * through the client's billing contact, billing email, and locations. One
 * lookup per distinct client/profile pair, keyed by invoice id.
 */
export async function resolveExportRecipientEmails(
  knex: Knex,
  tenantId: string,
  invoices: Iterable<{ invoice_id: string; client_id: string; billing_profile_id?: string | null }>,
): Promise<Map<string, string | null>> {
  const byTarget = new Map<string, Promise<string | null>>();
  const byInvoice = new Map<string, string | null>();

  for (const invoice of invoices) {
    const billingProfileId = invoice.billing_profile_id ?? null;
    const key = `${invoice.client_id}:${billingProfileId ?? ''}`;
    let pending = byTarget.get(key);
    if (!pending) {
      pending = resolveInvoiceBillingRecipient({
        knexOrTrx: knex,
        tenantId,
        clientId: invoice.client_id,
        billingProfileId,
      }).then((recipient) => recipient.recipientEmail || null);
      byTarget.set(key, pending);
    }
    byInvoice.set(invoice.invoice_id, await pending);
  }

  return byInvoice;
}

/** The client-level address (no profile), for a parent customer record. */
export async function resolveClientExportEmail(
  knex: Knex,
  tenantId: string,
  clientId: string,
): Promise<string | null> {
  const recipient = await resolveInvoiceBillingRecipient({ knexOrTrx: knex, tenantId, clientId });
  return recipient.recipientEmail || null;
}
