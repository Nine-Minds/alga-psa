import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import type { StripePaymentProvider } from './StripePaymentProvider';
import { resolveInvoiceBillingRecipient } from '@alga-psa/billing/services/invoiceBillingRecipientService';
import { signalInvoiceAutopay } from '../temporal/invoiceAutopay';

function balanceDue(totalAmount: number, creditApplied: number, totalPaid: number): number {
  return Math.round(totalAmount) - Math.round(creditApplied) - Math.round(totalPaid);
}

export async function expireAutopayPaymentLinks(
  knex: Knex,
  tenantId: string,
  invoiceId: string,
  provider: StripePaymentProvider,
): Promise<void> {
  const links = await tenantDb(knex, tenantId).table('invoice_payment_links')
    .where({ invoice_id: invoiceId, provider_type: 'stripe' }).whereIn('status', ['active', 'expire_pending']);
  for (const link of links) {
    try {
      await provider.expirePaymentLink(link.external_link_id);
      await tenantDb(knex, tenantId).table('invoice_payment_links').where({ link_id: link.link_id }).update({ status: 'expired' });
    } catch {
      await tenantDb(knex, tenantId).table('invoice_payment_links').where({ link_id: link.link_id }).update({ status: 'expire_pending' });
    }
  }
}

export async function recordAutopayPayment(
  knex: Knex,
  tenantId: string,
  input: { invoiceId: string; amount: number; currency: string; paymentIntentId: string },
): Promise<{ success: boolean; paymentRecorded: boolean; error?: string }> {
  const db = tenantDb(knex, tenantId);
  const invoice = await db.table('invoices').where({ invoice_id: input.invoiceId }).first();
  if (!invoice) return { success: false, paymentRecorded: false, error: `Invoice not found: ${input.invoiceId}` };
  if ((invoice.currency_code || 'USD').toUpperCase() !== input.currency.toUpperCase()) {
    return { success: false, paymentRecorded: false, error: 'Auto-pay payment currency does not match invoice currency' };
  }
  const result = await knex.transaction(async (trx) => {
    const scoped = tenantDb(trx, tenantId);
    await scoped.table('invoices').where({ invoice_id: input.invoiceId }).forUpdate().first();
    const existing = await scoped.table('invoice_payments').where({
      invoice_id: input.invoiceId, payment_method: 'stripe', reference_number: input.paymentIntentId,
    }).first();
    if (existing) return { paymentRecorded: false };
    const [payment] = await scoped.table('invoice_payments').insert({
      tenant: tenantId, invoice_id: input.invoiceId, amount: input.amount, payment_method: 'stripe',
      payment_date: new Date(), reference_number: input.paymentIntentId,
      notes: `Stripe auto-pay payment ${input.paymentIntentId}`,
    }).returning('payment_id');
    const paidRow = await scoped.table('invoice_payments').where({ invoice_id: input.invoiceId }).sum('amount as total').first();
    const paid = Number(paidRow?.total ?? 0);
    const due = balanceDue(Number(invoice.total_amount), Number(invoice.credit_applied ?? 0), paid);
    const status = due <= 0 ? 'paid' : invoice.status;
    await scoped.table('invoices').where({ invoice_id: input.invoiceId }).update({ status, updated_at: trx.fn.now() });
    await scoped.table('transactions').insert({
      transaction_id: uuidv4(), tenant: tenantId, client_id: invoice.client_id, invoice_id: input.invoiceId,
      amount: input.amount, type: 'payment', status: 'completed', description: `Payment received via Stripe - ${input.paymentIntentId}`,
      created_at: trx.fn.now(), metadata: { payment_provider: 'stripe', reference_number: input.paymentIntentId, currency: input.currency },
    });
    return { paymentRecorded: Boolean(payment?.payment_id) };
  });
  if (balanceDue(Number(invoice.total_amount), Number(invoice.credit_applied ?? 0), Number((await db.table('invoice_payments').where({ invoice_id: input.invoiceId }).sum('amount as total').first())?.total ?? 0)) <= 0) {
    await signalInvoiceAutopay(tenantId, input.invoiceId, 'invoiceSettled');
  }
  return { success: true, paymentRecorded: result.paymentRecorded };
}

export async function getAutopayPaymentLink(
  knex: Knex,
  tenantId: string,
  invoiceId: string,
  provider: StripePaymentProvider,
): Promise<{ url: string; paymentLinkId: string; externalLinkId: string; provider: string } | null> {
  const db = tenantDb(knex, tenantId);
  const invoice = await db.table('invoices').where({ invoice_id: invoiceId }).first();
  if (!invoice || invoice.status !== 'sent' || !invoice.finalized_at || invoice.invoice_type === 'credit_note') return null;
  const paid = await db.table('invoice_payments').where({ invoice_id: invoiceId }).sum('amount as total').first();
  const amount = balanceDue(Number(invoice.total_amount), Number(invoice.credit_applied ?? 0), Number(paid?.total ?? 0));
  if (amount <= 0) return null;
  const existing = await db.table('invoice_payment_links').where({ invoice_id: invoiceId, provider_type: 'stripe', status: 'active' }).where('expires_at', '>', new Date()).first();
  if (existing && Number(existing.amount) === amount) return { url: existing.url, paymentLinkId: existing.link_id, externalLinkId: existing.external_link_id, provider: 'stripe' };
  if (existing) await expireAutopayPaymentLinks(knex, tenantId, invoiceId, provider);
  const client = await db.table('clients').where({ client_id: invoice.client_id }).first();
  const recipient = await resolveInvoiceBillingRecipient({ knexOrTrx: knex, tenantId, clientId: invoice.client_id });
  if (!client || !recipient.recipientEmail) return null;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return provider.createPaymentLink({
    invoiceId, amount, currency: invoice.currency_code || 'USD', description: `Invoice ${invoice.invoice_number}`,
    clientId: client.client_id, clientEmail: recipient.recipientEmail, clientName: client.client_name,
    metadata: { tenant_id: tenantId, invoice_id: invoiceId, invoice_number: invoice.invoice_number, client_id: client.client_id },
    successUrl: `${baseUrl}/client-portal/billing/invoices/${invoiceId}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/client-portal/billing?tab=invoices&invoiceId=${encodeURIComponent(invoiceId)}`,
  });
}
