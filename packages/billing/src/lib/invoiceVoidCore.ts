import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { reverseCreditApplicationsForInvoice } from './creditReversal';
import { suppressPrepaidReplenishmentForVoidedInvoice } from './prepaidAutoReplenishment';
import { voidHourBlocksForVoidedInvoice } from '../services/prepaidBlockLifecycleService';

/**
 * Local invoice-void primitive shared by the user-facing void action
 * (voidInvoiceActions) and the accounting-sync external-void applier (an
 * invoice voided in QuickBooks/Xero is voided in Alga too). Permission checks,
 * remote enqueue and audit stay with the callers; this module owns the
 * guards and the state change itself.
 */

export type LocalVoidOutcome = { ok: true } | { ok: false; error: string };

export const CREDIT_ISSUANCE_TYPES = ['credit_issuance', 'credit_issuance_from_negative_invoice'] as const;

export interface VoidableInvoiceRow {
  invoice_id: string;
  client_id: string;
  status: string | null;
  finalized_at: string | null;
  total_amount: number | string | null;
  invoice_type?: string | null;
  is_prepayment?: boolean | null;
  credit_applied?: number | string | null;
}

export function isCreditNoteInvoice(invoice: VoidableInvoiceRow): boolean {
  return (
    invoice.invoice_type === 'credit_note' ||
    (Number(invoice.total_amount ?? 0) < 0 && !invoice.is_prepayment)
  );
}

/**
 * Unlocked fast-fail guards: recorded payments and consumed credit-note credit
 * both block a void. Returns the user-facing reason, or null when clear. The
 * authoritative re-check for consumed credit runs under lock inside
 * voidInvoiceLocally (TOCTOU).
 */
export async function findLocalVoidBlocker(
  knex: Knex,
  tenant: string,
  invoice: VoidableInvoiceRow
): Promise<string | null> {
  const invoiceId = invoice.invoice_id;

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
    return 'Unwind payments before voiding.';
  }

  if (isCreditNoteInvoice(invoice)) {
    const creditIssuanceTxns = await tenantDb(knex, tenant).table('transactions')
      .where({ invoice_id: invoiceId })
      .whereIn('type', [...CREDIT_ISSUANCE_TYPES])
      .select('transaction_id');
    const txnIds = creditIssuanceTxns.map((t: any) => t.transaction_id);

    if (txnIds.length > 0) {
      const consumedCredit = await tenantDb(knex, tenant).table('credit_tracking')
        .whereIn('transaction_id', txnIds)
        .where(knex.raw('remaining_amount < amount'))
        .first('credit_id');

      if (consumedCredit) {
        return 'This credit note has applied credit. Unapply the credit before voiding.';
      }
    }
  }

  return null;
}

export interface VoidInvoiceLocallyParams {
  /** Pre-transaction snapshot of the invoice (client, total, type). */
  invoice: VoidableInvoiceRow;
  /** `status` and `credit_applied` re-read under the caller's FOR UPDATE lock. */
  lockedInvoice: { status: string | null; credit_applied?: number | string | null };
  reason: string;
  /** Null for system-driven voids (accounting sync). */
  actorUserId: string | null;
  now: string;
  /** Extra metadata for the invoice_cancelled transaction (provenance). */
  transactionMetadata?: Record<string, unknown>;
}

/**
 * Void body. The caller holds the invoice row lock and has already refused
 * drafts and cancelled invoices. Statement order matters for the lock-order
 * contract with credit application (invoice row first, credit rows after).
 */
export async function voidInvoiceLocally(
  trx: Knex.Transaction,
  tenant: string,
  params: VoidInvoiceLocallyParams
): Promise<LocalVoidOutcome> {
  const { invoice, lockedInvoice, reason, actorUserId, now } = params;
  const invoiceId = invoice.invoice_id;

  // Hour blocks minted by this invoice: pending ones release, unused active
  // ones are voided, a used block refuses the void. Runs before any write.
  const blockOutcome = await voidHourBlocksForVoidedInvoice(trx, tenant, invoiceId, actorUserId, now, reason);
  if (blockOutcome.ok === false) {
    return { ok: false, error: blockOutcome.error };
  }

  if (isCreditNoteInvoice(invoice)) {
    // Claw back the issued pool credit, or the customer keeps spendable
    // phantom credit that no longer exists in the accounting system.
    const creditIssuanceTxns = await tenantDb(trx, tenant).table('transactions')
      .where({ invoice_id: invoiceId })
      .whereIn('type', [...CREDIT_ISSUANCE_TYPES])
      .select('transaction_id', 'client_id', 'amount');

    // Consumed-credit re-check under lock: queues behind an in-flight
    // application (lock order invoice row, then credit rows).
    if (creditIssuanceTxns.length > 0) {
      const lockedCreditRows = await tenantDb(trx, tenant).table('credit_tracking')
        .whereIn('transaction_id', creditIssuanceTxns.map((t: any) => t.transaction_id))
        .forUpdate()
        .select('amount', 'remaining_amount');

      const consumedUnderLock = lockedCreditRows.some(
        (row: any) => Number(row.remaining_amount) < Number(row.amount)
      );
      if (consumedUnderLock) {
        return { ok: false, error: 'This credit note has applied credit. Unapply the credit before voiding.' };
      }
    }

    for (const txn of creditIssuanceTxns) {
      const creditRow = await tenantDb(trx, tenant).table('credit_tracking')
        .where({ transaction_id: txn.transaction_id })
        .first('credit_id', 'remaining_amount');

      if (creditRow && Number(creditRow.remaining_amount) > 0) {
        const clawedBack = Number(creditRow.remaining_amount);

        await tenantDb(trx, tenant).table('credit_tracking')
          .where({ credit_id: creditRow.credit_id })
          .update({ remaining_amount: 0, updated_at: now });

        await tenantDb(trx, tenant).table('transactions').insert({
          transaction_id: uuidv4(),
          client_id: txn.client_id,
          invoice_id: invoiceId,
          amount: -clawedBack,
          type: 'credit_adjustment',
          status: 'completed',
          description: `Issued credit clawed back: credit note voided (${reason})`,
          created_at: now,
          balance_after: null,
          tenant,
          metadata: {
            reversal_of: txn.transaction_id,
            credit_id: creditRow.credit_id,
            reason: 'credit_note_voided',
            voided_by: actorUserId
          }
        });
      }
    }
  } else if (Number(lockedInvoice.credit_applied ?? 0) > 0) {
    // Standard invoice: restore every credit application (repeat-safe).
    await reverseCreditApplicationsForInvoice(trx, tenant, invoiceId, actorUserId, 'invoice_voided');
  }

  await tenantDb(trx, tenant).table('invoices')
    .where({ invoice_id: invoiceId })
    .update({ status: 'cancelled', updated_at: now });

  // Terminal for this replenishment episode, but the invoice row survives:
  // keep the link and suppress scans until settlement or explicit deletion.
  await suppressPrepaidReplenishmentForVoidedInvoice(trx, tenant, invoiceId);

  await tenantDb(trx, tenant).table('transactions').insert({
    transaction_id: uuidv4(),
    client_id: invoice.client_id,
    invoice_id: invoiceId,
    amount: -Number(invoice.total_amount ?? 0),
    type: 'invoice_cancelled',
    status: 'completed',
    description: `Invoice voided: ${reason}`,
    created_at: now,
    balance_after: null,
    tenant,
    metadata: {
      reason,
      voided_by: actorUserId,
      ...(params.transactionMetadata ?? {})
    }
  });

  return { ok: true };
}
