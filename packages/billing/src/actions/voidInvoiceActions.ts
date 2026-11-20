// @ts-nocheck
'use server'

import { tenantDb, withTransaction } from '@alga-psa/db';
import { createTenantKnex } from '@alga-psa/db';
import { writeAccountingAudit } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { ActionResultMessageKey } from '@alga-psa/ui/lib/errorHandling';
import { findLocalVoidBlocker, voidInvoiceLocally, type LocalVoidBlocker } from '../lib/invoiceVoidCore';
import { enqueueInvoiceVoid } from '../services/accountingSync/syncProducers';
import { notifyInvoiceTerminalStatus } from '../services/accountingSync/invoiceTerminalStatusHandlers';
import { hasConnectedQboRealm } from '../services/accountingSync/accountingSyncSettings';
import { findInvoiceExportInProgress } from '../services/accountingSync/invoiceExportGuards';
import { SyncMappingLedger } from '../services/accountingSync/syncMappingLedger';
import { SyncOperationsRepository } from '../services/accountingSync/syncOperationsRepository';
import { signalAutopayInvoiceSettled } from '../services/autopayBridge';

export type VoidInvoiceResult =
  | { success: true }
  | ({ success: false; error: string } & ActionResultMessageKey);

// Single, connection-based denial for every remote-affecting void refused for an
// actor without accounting_integrations:remote_mutate. Identical for mapped and
// unmapped invoices (it never names a per-invoice mapping), so the denial event
// cannot be used to learn whether any given invoice has a remote entity.
const VOID_REMOTE_MUTATE_DENIAL = 'Permission denied: voiding invoices while the accounting integration is connected requires the accounting remote-mutate permission.';

/**
 * Carries the structured blocker out as a refusal. `messageKey` is the normal
 * localization seam: withAuth rewrites `error` into the caller's locale on the
 * way out, so the dialog renders whatever it is handed.
 */
function blockerResult(blocker: LocalVoidBlocker): VoidInvoiceResult {
  return {
    success: false,
    error: blocker.message,
    messageKey: blocker.messageKey,
    ...(blocker.messageParams ? { messageParams: blocker.messageParams } : {}),
  };
}

export const voidInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  reason: string
): Promise<VoidInvoiceResult> => {
  // Voiding reverses credits and pushes voids to accounting integrations —
  // internal MSP users holding the dedicated invoice:void permission only.
  if (user.user_type === 'client') {
    return { success: false, error: 'Permission denied: operation not available in client portal' };
  }
  if (!await hasPermission(user, 'invoice', 'void')) {
    return { success: false, error: 'Permission denied: invoice void required' };
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
  // books.
  //
  // The denial depends on the tenant's CONNECTION state, never on whether this
  // invoice happens to be mapped: when the accounting integration is connected
  // and the actor lacks remote_mutate, the void is refused identically for
  // mapped and unmapped invoices, so a denial can never be used to learn
  // whether a remote entity exists for this invoice. Connection existence is
  // tenant-level configuration already visible to settings/catalog readers. On
  // an unconnected tenant invoice:update alone suffices.
  //
  // This read is a fast-fail only. The authoritative re-check runs inside the
  // transaction below (the capability can be revoked, or the connection added,
  // between this read and the commit), and the enqueue that would trigger the
  // remote side effect is additionally gated on the actor's remote-mutate
  // capability.
  const actorCanRemoteMutate = await hasPermission(user, 'accounting_integrations', 'remote_mutate', knex);
  if (!actorCanRemoteMutate && await hasConnectedQboRealm(tenant)) {
    return { success: false, error: VOID_REMOTE_MUTATE_DENIAL };
  }

  // Guards shared with the accounting-sync external-void path: recorded
  // payments and consumed credit-note credit. Unlocked fast-fail only — the
  // consumed-credit re-check runs under lock inside voidInvoiceLocally.
  const blocker = await findLocalVoidBlocker(knex, tenant, invoice);
  if (blocker) {
    return blockerResult(blocker);
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
    if (await findInvoiceExportInProgress(trx, tenant, invoiceId)) {
      return { success: false, error: 'An accounting export is being prepared for this invoice. Wait for it to finish before voiding it.' };
    }

    // Authoritative re-check of the remote-mutate capability under the
    // transaction. The pre-transaction read above is only a fast-fail on a
    // snapshot: the capability can be revoked between that read and here, and
    // the remote-affecting decision that decides whether a remote void is
    // enqueued must be evaluated atomically with the local state change. This
    // value supersedes `actorCanRemoteMutate` for every decision below
    // (including the post-commit enqueue).
    actorCanRemoteMutateUnderLock = await hasPermission(user, 'accounting_integrations', 'remote_mutate', trx);

    // The connection-based denial is repeated under the transaction so a
    // connection added between the fast-fail and here is caught. Like the
    // fast-fail it is independent of the per-invoice mapping read below:
    // mapped and unmapped invoices are refused identically for an actor
    // without remote_mutate on a connected tenant.
    if (!actorCanRemoteMutateUnderLock && await hasConnectedQboRealm(tenant)) {
      return { success: false, error: VOID_REMOTE_MUTATE_DENIAL };
    }

    // Authoritative read of the remote-mapping gate under the transaction.
    // This decides the BEHAVIORAL branch — whether a remote void is enqueued
    // and which remote entity the audit record names — not the permission
    // denial above. It runs under the invoice row lock so a mapping created by
    // a concurrent export is visible here; a cancelled invoice can never gain
    // a mapping because every mapping write holds this same lock and refuses
    // cancelled invoices (lockInvoiceForExternalSync). Nothing has been written
    // yet, so returning here refuses the whole void.
    const remoteMapping = await tenantDb(trx, tenant).table('tenant_external_entity_mappings')
      .where({
        tenant,
        integration_type: 'quickbooks_online',
        alga_entity_type: 'invoice',
        alga_entity_id: invoiceId
      })
      .first('id', 'external_entity_id');
    const remoteVoidWillPropagate = Boolean(remoteMapping);

    // Hour blocks, credit claw-back / reversal, status flip, replenishment
    // suppression and the invoice_cancelled transaction live in the shared
    // primitive (also used when the provider voids an exported invoice). A
    // refusal (used hour block, consumed credit) commits nothing.
    const localVoid = await voidInvoiceLocally(trx, tenant, {
      invoice,
      lockedInvoice,
      reason: trimmedReason,
      actorUserId: user.user_id,
      now
    });
    if (!localVoid.ok) {
      return { success: false, error: localVoid.error };
    }

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

  void signalAutopayInvoiceSettled(tenant, invoiceId);

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

/**
 * Voids an invoice in AlgaPSA and leaves the accounting system's copy alone.
 *
 * For a document that should never have been linked at all — a test invoice,
 * or one the onboarding wizard matched to a real QuickBooks invoice with the
 * same number. The normal void would queue a void of that real remote
 * document; this one unlinks instead: it tombstones the invoice mapping (and
 * the mappings of its payments), retires every queued push for the invoice,
 * and never calls enqueueInvoiceVoid.
 *
 * The books will disagree afterwards, deliberately and on the record, so it
 * takes the same admin-level accounting capability as a remote void. Payments
 * must already be gone (reverse them first); the local guards are the normal
 * void's, unchanged.
 */
export const voidInvoiceInAlgaOnly = withAuth(async (
  user,
  { tenant },
  invoiceId: string,
  reason: string
): Promise<VoidInvoiceResult> => {
  if (user.user_type === 'client') {
    return { success: false, error: 'Permission denied: operation not available in client portal' };
  }
  if (!await hasPermission(user, 'invoice', 'void')) {
    return { success: false, error: 'Permission denied: invoice void required' };
  }

  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    return { success: false, error: 'A reason is required to void an invoice.' };
  }

  const { knex } = await createTenantKnex();
  const now = new Date().toISOString();

  // Unlinking is the remote-affecting decision here (the remote document is
  // abandoned, not voided), so it carries the same capability as a remote void.
  if (!await hasPermission(user, 'accounting_integrations', 'remote_mutate', knex)) {
    return { success: false, error: VOID_REMOTE_MUTATE_DENIAL };
  }

  const invoice = await tenantDb(knex, tenant).table('invoices')
    .where({ invoice_id: invoiceId })
    .first();

  if (!invoice) {
    return { success: false, error: 'Invoice not found.' };
  }
  if (!invoice.finalized_at) {
    return { success: false, error: 'Drafts must be deleted, not voided.' };
  }
  if (invoice.status === 'cancelled') {
    return { success: false, error: 'Invoice is already voided.' };
  }

  // Payments must be reversed first — the same shared guard as the normal
  // void, so an AlgaPSA-only void can never be the back door around it.
  const blocker = await findLocalVoidBlocker(knex, tenant, invoice);
  if (blocker) {
    return blockerResult(blocker);
  }

  const outcome = await withTransaction(knex, async (trx: Knex.Transaction): Promise<VoidInvoiceResult> => {
    // Same lock-order contract as voidInvoice: invoice row FIRST, credit rows
    // after, so a concurrent credit application queues instead of deadlocking.
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
    if (await findInvoiceExportInProgress(trx, tenant, invoiceId)) {
      return { success: false, error: 'An accounting export is being prepared for this invoice. Wait for it to finish before voiding it.' };
    }

    // Authoritative re-check under the lock: the capability can be revoked
    // between the fast-fail above and the commit.
    if (!await hasPermission(user, 'accounting_integrations', 'remote_mutate', trx)) {
      return { success: false, error: VOID_REMOTE_MUTATE_DENIAL };
    }

    const mappings = await tenantDb(trx, tenant).table('tenant_external_entity_mappings')
      .where({ alga_entity_type: 'invoice', alga_entity_id: invoiceId })
      .whereNull('deleted_at')
      .select('id', 'integration_type', 'external_entity_id');

    // Payment mappings whose allocations point at this invoice go too: left
    // live they would keep claiming payments on a document that is gone here.
    const paymentMappings = await tenantDb(trx, tenant).table('tenant_external_entity_mappings')
      .where({ alga_entity_type: 'invoice_payment' })
      .whereNull('deleted_at')
      .whereRaw("metadata->'allocations' @> ?::jsonb", [JSON.stringify([{ invoiceId }])])
      .select('id', 'integration_type', 'alga_entity_id');

    const localVoid = await voidInvoiceLocally(trx, tenant, {
      invoice,
      lockedInvoice,
      reason: trimmedReason,
      actorUserId: user.user_id,
      now,
      transactionMetadata: {
        source: 'alga_only_void',
        remote_record_untouched: true,
        unlinked_external_ids: mappings.map((mapping: any) => mapping.external_entity_id),
      },
    });
    if (!localVoid.ok) {
      return { success: false, error: localVoid.error };
    }

    const unlinkMetadata = {
      locally_voided: true,
      locally_voided_by: user.user_id,
      locally_voided_at: now,
      locally_voided_reason: trimmedReason,
    };
    for (const mapping of mappings) {
      await new SyncMappingLedger(trx, tenant, mapping.integration_type)
        .tombstone(mapping.id, { syncStatus: 'unlinked', metadata: unlinkMetadata });
    }
    for (const mapping of paymentMappings) {
      await new SyncMappingLedger(trx, tenant, mapping.integration_type)
        .tombstone(mapping.id, { syncStatus: 'unlinked', metadata: { ...unlinkMetadata, locally_reversed: true } });
    }

    // Queued work for a document that is leaving the integration must never
    // reach the provider.
    const operations = new SyncOperationsRepository(trx);
    await operations.skipPending(
      tenant,
      ['export_invoice', 'void_invoice'],
      'invoice',
      [invoiceId],
      `Invoice voided in AlgaPSA only: ${trimmedReason}`
    );
    const paymentIds = paymentMappings.map((mapping: any) => mapping.alga_entity_id);
    if (paymentIds.length > 0) {
      await operations.skipPending(
        tenant,
        ['record_payment'],
        'invoice_payment',
        paymentIds,
        `Invoice voided in AlgaPSA only: ${trimmedReason}`
      );
    }

    for (const mapping of mappings) {
      await writeAccountingAudit(trx, tenant, 'accounting_alga_only_void', {
        userId: user.user_id,
        provider: mapping.integration_type === 'xero' ? 'xero' : 'quickbooks_online',
        recordId: String(mapping.external_entity_id ?? mapping.id),
        details: {
          algaEntityType: 'invoice',
          algaEntityId: invoiceId,
          operation: 'void_invoice_alga_only',
          outcome: 'unlinked',
          reason: trimmedReason,
          // The whole point of the record: nothing was asked of the provider.
          remoteRecordUntouched: true,
        },
      }).catch((error) => {
        console.warn('[voidInvoiceInAlgaOnly] Failed to write the Alga-only void audit entry', error);
      });
    }

    return { success: true };
  });

  if (!outcome.success) {
    return outcome;
  }

  // Deliberately NO enqueueInvoiceVoid: the remote document stays as it is.
  void signalAutopayInvoiceSettled(tenant, invoiceId);

  await notifyInvoiceTerminalStatus({
    knex,
    tenantId: tenant,
    invoiceId,
    newStatus: 'cancelled',
  });

  return { success: true };
});
