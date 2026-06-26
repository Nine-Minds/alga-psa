// @ts-nocheck
'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { withAuth } from '@alga-psa/auth';
import { enqueueInvoiceVoid } from '../services/accountingSync/syncProducers';

// Exported for testing
export async function reverseCreditApplicationsForInvoice(
  trx: Knex.Transaction,
  tenant: string,
  invoiceId: string,
  userId: string
): Promise<void> {
  // Find all credit_application transactions for this invoice
  const creditAppTxns = await tenantDb(trx, tenant).table('transactions')
    .where({ invoice_id: invoiceId, type: 'credit_application' })
    .select('*');

  for (const txn of creditAppTxns) {
    const appliedCredits: Array<{ creditId: string; amount: number }> =
      (txn.metadata as any)?.applied_credits ?? [];

    let totalRestored = 0;

    for (const applied of appliedCredits) {
      // Restore the credit tracking pool
      await tenantDb(trx, tenant).table('credit_tracking')
        .where({ credit_id: applied.creditId })
        .increment('remaining_amount', applied.amount)
        .update({ updated_at: new Date().toISOString() });

      totalRestored += applied.amount;
    }

    if (totalRestored > 0) {
      // Restore client credit balance
      await tenantDb(trx, tenant).table('clients')
        .where({ client_id: txn.client_id })
        .increment('credit_balance', totalRestored);

      // Write reversing transaction
      await tenantDb(trx, tenant).table('transactions').insert({
        transaction_id: uuidv4(),
        client_id: txn.client_id,
        invoice_id: invoiceId,
        amount: totalRestored,
        type: 'credit_adjustment',
        status: 'completed',
        description: `Credit reversal due to invoice void`,
        created_at: new Date().toISOString(),
        balance_after: null,
        tenant,
        metadata: {
          reversal_of: txn.transaction_id,
          reason: 'invoice_voided'
        }
      });
    }
  }

  // Zero out credit_applied on the invoice
  if (creditAppTxns.length > 0) {
    await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .update({ credit_applied: 0, updated_at: new Date().toISOString() });
  }
}

export const voidInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  reason: string
) => {
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    throw new Error('A reason is required to void an invoice.');
  }

  const { knex } = await createTenantKnex();
  const now = new Date().toISOString();

  // Load invoice
  const invoice = await tenantDb(knex, tenant).table('invoices')
    .where({ invoice_id: invoiceId })
    .first();

  if (!invoice) {
    throw new Error('Invoice not found.');
  }

  // Guard: drafts must be deleted, not voided
  if (!invoice.finalized_at) {
    throw new Error('Drafts must be deleted, not voided.');
  }

  // Guard: already cancelled
  if (invoice.status === 'cancelled') {
    throw new Error('Invoice is already voided.');
  }

  // Guard: payments exist
  let paymentSum = 0;
  try {
    const paymentRow = await tenantDb(knex, tenant).table('invoice_payments')
      .where({ invoice_id: invoiceId })
      .sum('amount as total')
      .first();
    paymentSum = Number(paymentRow?.total ?? 0);
  } catch {
    paymentSum = 0;
  }
  if (paymentSum > 0) {
    throw new Error('Unwind payments before voiding.');
  }

  // Guard: consumed credit notes (for credit note invoices)
  // A credit note has consumed credit when credit_tracking rows linked to it
  // have remaining_amount < amount (i.e. some credit was used)
  const isCreditNote =
    invoice.invoice_type === 'credit_note' ||
    (Number(invoice.total_amount ?? 0) < 0 && !invoice.is_prepayment);

  if (isCreditNote) {
    // Find transactions generated from this invoice (credit issuance).
    // Credit notes finalized from negative invoices write
    // 'credit_issuance_from_negative_invoice'; prepayment credits write
    // 'credit_issuance' — cover both so neither slips through the guard.
    const creditIssuanceTxns = await tenantDb(knex, tenant).table('transactions')
      .where({ invoice_id: invoiceId })
      .whereIn('type', ['credit_issuance', 'credit_issuance_from_negative_invoice'])
      .select('transaction_id');
    const txnIds = creditIssuanceTxns.map((t: any) => t.transaction_id);

    if (txnIds.length > 0) {
      const consumedCredit = await tenantDb(knex, tenant).table('credit_tracking')
        .whereIn('transaction_id', txnIds)
        .where(knex.raw('remaining_amount < amount'))
        .first('credit_id');

      if (consumedCredit) {
        throw new Error('This credit note has applied credit. Unapply the credit before voiding.');
      }
    }
  }

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    if (isCreditNote) {
      // Claw back the issued pool credit: voiding the source document must
      // remove the credit it put into the pool, or the customer keeps
      // spendable phantom credit that no longer exists in the accounting
      // system. Matches both issuance transaction types (see guard above).
      const creditIssuanceTxns = await tenantDb(trx, tenant).table('transactions')
        .where({ invoice_id: invoiceId })
        .whereIn('type', ['credit_issuance', 'credit_issuance_from_negative_invoice'])
        .select('transaction_id', 'client_id', 'amount');

      for (const txn of creditIssuanceTxns) {
        const creditRow = await tenantDb(trx, tenant).table('credit_tracking')
          .where({ transaction_id: txn.transaction_id })
          .first('credit_id', 'remaining_amount');

        if (creditRow && Number(creditRow.remaining_amount) > 0) {
          const clawedBack = Number(creditRow.remaining_amount);

          // Decrement client.credit_balance by remaining amount
          await tenantDb(trx, tenant).table('clients')
            .where({ client_id: txn.client_id })
            .decrement('credit_balance', clawedBack);

          // Zero out the credit tracking entry
          await tenantDb(trx, tenant).table('credit_tracking')
            .where({ credit_id: creditRow.credit_id })
            .update({ remaining_amount: 0, updated_at: now });

          // Audit trail for the balance change
          await tenantDb(trx, tenant).table('transactions').insert({
            transaction_id: uuidv4(),
            client_id: txn.client_id,
            invoice_id: invoiceId,
            amount: -clawedBack,
            type: 'credit_adjustment',
            status: 'completed',
            description: `Issued credit clawed back: credit note voided (${trimmedReason})`,
            created_at: now,
            balance_after: null,
            tenant,
            metadata: {
              reversal_of: txn.transaction_id,
              credit_id: creditRow.credit_id,
              reason: 'credit_note_voided',
              voided_by: user.user_id
            }
          });
        }
      }
    } else {
      // Standard invoice: reverse any credit applications
      if (Number(invoice.credit_applied ?? 0) > 0) {
        await reverseCreditApplicationsForInvoice(trx, tenant, invoiceId, user.user_id);
      }
    }

    // Update invoice status to cancelled
    await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .update({ status: 'cancelled', updated_at: now });

    // Write invoice_cancelled transaction
    await tenantDb(trx, tenant).table('transactions').insert({
      transaction_id: uuidv4(),
      client_id: invoice.client_id,
      invoice_id: invoiceId,
      amount: -Number(invoice.total_amount ?? 0),
      type: 'invoice_cancelled',
      status: 'completed',
      description: `Invoice voided: ${trimmedReason}`,
      created_at: now,
      balance_after: null,
      tenant,
      metadata: {
        reason: trimmedReason,
        voided_by: user.user_id
      }
    });
  });

  // Fire-and-forget: enqueue void_invoice op if accounting mapping exists
  const { knex: syncKnex } = await createTenantKnex();
  void enqueueInvoiceVoid(syncKnex, tenant, invoiceId);
});
