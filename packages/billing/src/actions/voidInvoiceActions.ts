// @ts-nocheck
'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { writeAccountingAudit } from '@alga-psa/db';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { reverseCreditApplicationsForInvoice } from '../lib/creditReversal';
import { enqueueInvoiceVoid } from '../services/accountingSync/syncProducers';
import { notifyInvoiceTerminalStatus } from '../services/accountingSync/invoiceTerminalStatusHandlers';
import { suppressPrepaidReplenishmentForVoidedInvoice } from '../lib/prepaidAutoReplenishment';

export type VoidInvoiceResult =
  | { success: true }
  | { success: false; error: string };

export const voidInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  reason: string
): Promise<VoidInvoiceResult> => {
  // Voiding reverses credits and pushes voids to accounting integrations —
  // internal MSP users with invoice update permission only.
  if (user.user_type === 'client') {
    return { success: false, error: 'Permission denied: operation not available in client portal' };
  }
  if (!await hasPermission(user, 'invoice', 'update')) {
    return { success: false, error: 'Permission denied: invoice update required' };
  }

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { success: false, error: 'A reason is required to void an invoice.' };
  }

  const { knex } = await createTenantKnex();
  const now = new Date().toISOString();
  // Load invoice
  const invoice = await tenantDb(knex, tenant).table('invoices')
    .where({ invoice_id: invoiceId })
    .first();

  if (!invoice) {
    return { success: false, error: 'Invoice not found.' };
  }

  // Guard: drafts must be deleted, not voided
  if (!invoice.finalized_at) {
    return { success: false, error: 'Drafts must be deleted, not voided.' };
  }

  // Guard: already cancelled
  if (invoice.status === 'cancelled') {
    return { success: false, error: 'Invoice is already voided.' };
  }

  // An invoice that was exported to the accounting integration carries its
  // void into the remote ledger (QuickBooks void / credit-memo delete). That
  // remote mutation is a distinct, admin-only capability: Finance can run
  // exports but cannot void remote documents, so a void that would propagate
  // remotely is refused up front rather than silently desynchronizing the
  // books. Unmapped invoices void locally with invoice:update alone.
  //
  // This read is a fast-fail only. The authoritative re-check runs inside the
  // transaction below (a mapping can be created by a concurrent export between
  // this read and the commit), and the enqueue that would trigger the remote
  // side effect is additionally gated on the actor's remote-mutate capability.
  const actorCanRemoteMutate = await hasPermission(user, 'accounting_integrations', 'remote_mutate', knex);
  const remoteMapping = await tenantDb(knex, tenant).table('tenant_external_entity_mappings')
    .where({
      tenant,
      integration_type: 'quickbooks_online',
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId
    })
    .first('id');
  if (remoteMapping && !actorCanRemoteMutate) {
    return { success: false, error: 'Permission denied: voiding invoices that sync to the accounting integration requires the accounting remote-mutate permission.' };
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
    return { success: false, error: 'Unwind payments before voiding.' };
  }

  // Guard: consumed credit notes (for credit note invoices)
  // A credit note has consumed credit when credit_tracking rows linked to it
  // have remaining_amount < amount (i.e. some credit was used).
  // This read is an unlocked fast-fail only — the authoritative re-check runs
  // inside the transaction below, after the row locks (TOCTOU).
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
        return { success: false, error: 'This credit note has applied credit. Unapply the credit before voiding.' };
      }
    }
  }

  // Hoisted authoritative remote-mutate capability: starts as the fast-fail
  // snapshot and is superseded by the in-transaction re-check below. Read by
  // the audit decision (inside the transaction) and the post-commit enqueue.
  let actorCanRemoteMutateUnderLock = actorCanRemoteMutate;

  const outcome = await withTransaction(knex, async (trx: Knex.Transaction): Promise<VoidInvoiceResult> => {
    // Lock-order contract with applyCreditToInvoiceInternal (creditActions.ts):
    // invoice row FIRST, credit_tracking rows only after. Credit application
    // locks the invoice row FOR UPDATE and then the client's credit_tracking
    // rows; before this lock the void path wrote credit_tracking first and the
    // invoice row last, so a concurrent apply + void could each hold one lock
    // while waiting on the other — a PostgreSQL deadlock (40P01). Taking the
    // same invoice row lock as this transaction's first statement makes void
    // queue behind (or ahead of) apply instead of interleaving with it.
    //
    // The re-read under the lock also supersedes the pre-transaction snapshot
    // for every in-transaction decision: `status` (a concurrent void may have
    // cancelled the invoice between the guard read and here — without this
    // re-check both voids would restore the applied credits twice) and
    // `credit_applied` (a concurrent application may have changed it).
    const lockedInvoice = await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .forUpdate()
      .first('status', 'credit_applied');

    if (!lockedInvoice) {
      return { success: false, error: 'Invoice not found.' };
    }
    if (lockedInvoice.status === 'cancelled') {
      return { success: false, error: 'Invoice is already voided.' };
    }

    // Authoritative re-check of the remote-mutate capability under the
    // transaction. The pre-transaction read above is only a fast-fail on a
    // snapshot: the capability can be revoked between that read and here, and
    // the remote-affecting decision (mapping + permission) that decides whether
    // a remote void is enqueued must be evaluated atomically with the local
    // state change. This value supersedes `actorCanRemoteMutate` for every
    // decision below (including the post-commit enqueue).
    actorCanRemoteMutateUnderLock = await hasPermission(user, 'accounting_integrations', 'remote_mutate', trx);

    // Authoritative re-check of the remote-mapping gate under the transaction.
    // The pre-transaction read above is only a fast-fail on a snapshot: a
    // concurrent export can map this invoice between that read and here, in
    // which case the void is now remote-affecting and must be refused for an
    // actor without remote_mutate rather than cancelled locally while the books
    // desynchronize. Nothing has been written yet, so returning refuses the
    // whole void. The remote entity id read here also feeds the audit record
    // for the remote-affecting branch.
    const remoteMapping = await tenantDb(trx, tenant).table('tenant_external_entity_mappings')
      .where({
        tenant,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'invoice',
        alga_entity_id: invoiceId
      })
      .first('id', 'external_entity_id');
    if (remoteMapping && !actorCanRemoteMutateUnderLock) {
      return { success: false, error: 'Permission denied: voiding invoices that sync to the accounting integration requires the accounting remote-mutate permission.' };
    }
    const remoteVoidWillPropagate = Boolean(remoteMapping);

    if (isCreditNote) {
      // Claw back the issued pool credit: voiding the source document must
      // remove the credit it put into the pool, or the customer keeps
      // spendable phantom credit that no longer exists in the accounting
      // system. Matches both issuance transaction types (see guard above).
      const creditIssuanceTxns = await tenantDb(trx, tenant).table('transactions')
        .where({ invoice_id: invoiceId })
        .whereIn('type', ['credit_issuance', 'credit_issuance_from_negative_invoice'])
        .select('transaction_id', 'client_id', 'amount');

      // Re-check the consumed guard UNDER LOCK. The pre-transaction guard is
      // only a fast-fail on a snapshot: a concurrent
      // applyCreditToInvoiceInternal can consume this note's credit between
      // that read and this transaction. The invoice row lock above does not
      // serialize against it — the application locks the TARGET invoice's
      // row, not this credit note's — so contention lands on the
      // credit_tracking rows, which the apply path holds FOR UPDATE until it
      // commits. Taking FOR UPDATE here queues behind any in-flight
      // application (lock order invoice-row-then-credit-rows, matching
      // applyCreditToInvoiceInternal), making this re-read authoritative:
      // without it, the claw-back below zeroes out credit the concurrent
      // application just spent, voiding a consumed credit note.
      if (creditIssuanceTxns.length > 0) {
        const lockedCreditRows = await tenantDb(trx, tenant).table('credit_tracking')
          .whereIn('transaction_id', creditIssuanceTxns.map((t: any) => t.transaction_id))
          .forUpdate()
          .select('amount', 'remaining_amount');

        const consumedUnderLock = lockedCreditRows.some(
          (row: any) => Number(row.remaining_amount) < Number(row.amount)
        );
        if (consumedUnderLock) {
          return { success: false, error: 'This credit note has applied credit. Unapply the credit before voiding.' };
        }
      }

      for (const txn of creditIssuanceTxns) {
        const creditRow = await tenantDb(trx, tenant).table('credit_tracking')
          .where({ transaction_id: txn.transaction_id })
          .first('credit_id', 'remaining_amount');

        if (creditRow && Number(creditRow.remaining_amount) > 0) {
          const clawedBack = Number(creditRow.remaining_amount);

          // Zero out the credit tracking entry (removes it from the derived balance)
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
      // Standard invoice: reverse any credit applications. Decided from the
      // locked row, not the pre-transaction snapshot — a concurrent
      // application committing between the two reads is invisible to the
      // snapshot but must still be reversed. The canonical primitive
      // (packages/billing/src/lib/creditReversal.ts) is repeat-safe and
      // restores every application.
      if (Number(lockedInvoice.credit_applied ?? 0) > 0) {
        await reverseCreditApplicationsForInvoice(trx, tenant, invoiceId, user.user_id, 'invoice_voided');
      }
    }

    // Update invoice status to cancelled
    await tenantDb(trx, tenant).table('invoices')
      .where({ invoice_id: invoiceId })
      .update({ status: 'cancelled', updated_at: now });

    // A void is terminal for this replenishment episode, but unlike deletion
    // the invoice row survives. Keep the link and suppress future scans while
    // the balance remains low; only settlement or explicit deletion re-arms.
    await suppressPrepaidReplenishmentForVoidedInvoice(trx, tenant, invoiceId);

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

    // The remote-affecting branch is audited in the same transaction as the
    // local state change so the record survives even if the background drain
    // is delayed or the process dies between commit and enqueue. The outcome
    // (voided/failed) is appended by the sync-cycle applier, which carries the
    // same actor through the op payload. No secret material — only the
    // provider, the remote entity, and the outcome so far.
    if (remoteVoidWillPropagate && actorCanRemoteMutateUnderLock) {
      await writeAccountingAudit(trx, tenant, 'accounting_remote_void', {
        userId: user.user_id,
        provider: 'quickbooks_online',
        recordId: String(remoteMapping.external_entity_id ?? remoteMapping.id),
        details: {
          algaEntityType: 'invoice',
          algaEntityId: invoiceId,
          operation: 'void_invoice',
          outcome: 'enqueued',
          source: 'invoice_void',
        },
      }).catch((error) => {
        // The audit is durable evidence, never a reason to fail the void
        // itself — the background applier records the outcome independently.
        console.warn('[voidInvoice] Failed to write remote-void audit entry', error);
      });
    }

    return { success: true };
  });

  if (!outcome.success) {
    return outcome;
  }

  // Fire-and-forget: enqueue void_invoice op if accounting mapping exists.
  // The enqueue is additionally gated on the actor's remote-mutate capability
  // (re-evaluated under the void transaction above) so a mapping created by a
  // concurrent export between the gate check and this point cannot turn a
  // local-only void into a remote mutation the actor was not authorized to
  // perform.
  const { knex: syncKnex } = await createTenantKnex();
  void enqueueInvoiceVoid(syncKnex, tenant, invoiceId, {
    actorUserId: user.user_id,
    allowRemoteMutate: actorCanRemoteMutateUnderLock,
  });

  // Reconcile any still-active Checkout sessions: a voided invoice must never
  // be chargeable through an old email link. Best-effort (isolated handlers),
  // so the void response is unaffected.
  await notifyInvoiceTerminalStatus({
    knex,
    tenantId: tenant,
    invoiceId,
    newStatus: 'cancelled',
  });

  return { success: true };
});
