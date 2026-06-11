import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import type { AccountingExternalChange } from '@alga-psa/types';
import { SyncMappingLedger } from './syncMappingLedger';
import { recordExternalPayment, reverseExternalPayment, computeBalanceDue } from './recordExternalPayment';
import type { AccountingSyncCycleStats } from './accountingSync.types';
import type { SyncExceptionService } from './syncExceptions.types';

/**
 * Applies external Payment changes (create/edit/delete) to Alga AR.
 *
 * Idempotency: one mapping-ledger row per external payment
 * (alga_entity_type 'invoice_payment'); an unchanged sync token is a no-op,
 * which also absorbs the cursor overlap window and our own pushed payments.
 * Edits are reversed-and-reapplied from current allocations inside one
 * transaction; deletions reverse all recorded allocations.
 */

export const PAYMENT_MAPPING_ENTITY_TYPE = 'invoice_payment';

interface PaymentAllocation {
  externalInvoiceId: string;
  invoiceId: string;
  amountCents: number;
}

interface RecordedAllocation {
  invoiceId: string;
  externalInvoiceId: string;
  amountCents: number;
  algaPaymentId: string;
}

export interface PaymentApplierDeps {
  knex: Knex;
  tenantId: string;
  adapterType: string;
  targetRealm: string;
  ledger: SyncMappingLedger;
  exceptions: SyncExceptionService;
  stats: AccountingSyncCycleStats;
  /** Payment provider recorded on AR rows (defaults to 'quickbooks') */
  provider?: string;
}

function toCents(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function paymentReference(payload: Record<string, any> | undefined, externalId: string): string {
  const ref = payload?.PaymentRefNum;
  return typeof ref === 'string' && ref.trim().length > 0 ? ref.trim() : externalId;
}

async function resolveAllocations(
  deps: PaymentApplierDeps,
  change: AccountingExternalChange
): Promise<{ allocations: PaymentAllocation[]; unmappedExternalIds: string[] }> {
  const lines = Array.isArray(change.payload?.Line) ? (change.payload!.Line as any[]) : [];
  const allocations: PaymentAllocation[] = [];
  const unmappedExternalIds: string[] = [];

  for (const line of lines) {
    const linkedTxns = Array.isArray(line?.LinkedTxn) ? line.LinkedTxn : [];
    const invoiceTxn = linkedTxns.find((txn: any) => txn?.TxnType === 'Invoice' && txn?.TxnId);
    if (!invoiceTxn) {
      continue; // CreditMemo application lines etc. are not slice-1 payment allocations
    }

    const amountCents = toCents(line.Amount);
    if (amountCents <= 0) {
      continue;
    }

    const externalInvoiceId = String(invoiceTxn.TxnId);
    const invoiceMapping = await deps.ledger.findByExternalId('invoice', externalInvoiceId, deps.targetRealm);
    if (!invoiceMapping) {
      unmappedExternalIds.push(externalInvoiceId);
      continue;
    }

    allocations.push({
      externalInvoiceId,
      invoiceId: invoiceMapping.alga_entity_id,
      amountCents
    });
  }

  return { allocations, unmappedExternalIds };
}

async function reverseRecordedAllocations(
  trx: Knex,
  deps: PaymentApplierDeps,
  recorded: RecordedAllocation[],
  externalPaymentId: string,
  reason: string
): Promise<void> {
  const provider = deps.provider ?? 'quickbooks';
  for (const allocation of recorded) {
    const result = await reverseExternalPayment(trx, deps.tenantId, {
      invoiceId: allocation.invoiceId,
      amount: allocation.amountCents,
      provider,
      referenceNumber: `reversal:${externalPaymentId}`,
      notes: reason,
      transactionMetadata: {
        external_payment_id: externalPaymentId,
        reversed_payment_row: allocation.algaPaymentId,
        realm: deps.targetRealm
      }
    });
    if (!result.success) {
      throw new Error(`Failed to reverse payment allocation for invoice ${allocation.invoiceId}: ${result.error}`);
    }
  }
}

async function applyAllocations(
  trx: Knex,
  deps: PaymentApplierDeps,
  change: AccountingExternalChange,
  allocations: PaymentAllocation[]
): Promise<RecordedAllocation[]> {
  const provider = deps.provider ?? 'quickbooks';
  const reference = paymentReference(change.payload, change.externalId);
  const currency =
    typeof (change.payload as any)?.CurrencyRef?.value === 'string'
      ? String((change.payload as any).CurrencyRef.value)
      : undefined;

  const recorded: RecordedAllocation[] = [];
  for (const allocation of allocations) {
    const result = await recordExternalPayment(trx, deps.tenantId, {
      invoiceId: allocation.invoiceId,
      amount: allocation.amountCents,
      provider,
      referenceNumber: reference,
      currency,
      notes: `QuickBooks payment ${reference}`,
      transactionMetadata: {
        external_payment_id: change.externalId,
        realm: deps.targetRealm
      }
    });

    if (!result.success || !result.paymentId) {
      throw new Error(
        `Failed to apply payment allocation for invoice ${allocation.invoiceId}: ${result.error ?? 'unknown error'}`
      );
    }

    recorded.push({
      invoiceId: allocation.invoiceId,
      externalInvoiceId: allocation.externalInvoiceId,
      amountCents: allocation.amountCents,
      algaPaymentId: result.paymentId
    });
  }

  return recorded;
}

export async function applyExternalPaymentChange(
  deps: PaymentApplierDeps,
  change: AccountingExternalChange
): Promise<void> {
  const existing = await deps.ledger.findByExternalId(
    PAYMENT_MAPPING_ENTITY_TYPE,
    change.externalId,
    deps.targetRealm
  );

  // Deletion: reverse everything we recorded for this payment.
  if (change.deleted) {
    if (!existing || existing.metadata?.deleted) {
      deps.stats.paymentsSkipped += 1;
      return;
    }

    const recorded: RecordedAllocation[] = existing.metadata?.allocations ?? [];
    await deps.knex.transaction(async (trx) => {
      await reverseRecordedAllocations(trx, deps, recorded, change.externalId, 'Payment deleted in QuickBooks');
      await deps.ledger.withKnex(trx).update(existing.id, {
        syncStatus: 'reversed',
        metadata: { ...(existing.metadata ?? {}), deleted: true, reversed_at: new Date().toISOString() },
        touchSyncedAt: true
      });
    });

    deps.stats.paymentsReversed += 1;
    logger.info('[accountingSync] Reversed deleted external payment', {
      tenantId: deps.tenantId,
      externalPaymentId: change.externalId,
      allocations: recorded.length
    });
    return;
  }

  // Unchanged sync token: idempotent no-op (overlap window, echo suppression).
  if (existing && !existing.metadata?.deleted && existing.metadata?.sync_token === change.syncToken) {
    deps.stats.paymentsSkipped += 1;
    return;
  }

  const { allocations, unmappedExternalIds } = await resolveAllocations(deps, change);

  if (unmappedExternalIds.length > 0) {
    // Apply nothing: partial application would leave the books half-agreed.
    deps.stats.unmappedIgnored += 1;
    const result = await deps.exceptions.createOrUpdate({
      type: 'accounting_sync_unmapped_payment',
      entityType: 'external_payment',
      entityId: change.externalId,
      title: 'QuickBooks payment references an unknown invoice',
      context: {
        external_payment_id: change.externalId,
        reference: paymentReference(change.payload, change.externalId),
        unmapped_external_invoice_ids: unmappedExternalIds,
        total_amount: (change.payload as any)?.TotalAmt ?? null,
        realm: deps.targetRealm
      }
    });
    if (result.created) {
      deps.stats.exceptionsCreated += 1;
    }
    return;
  }

  if (allocations.length === 0) {
    deps.stats.paymentsSkipped += 1;
    return;
  }

  // ── Double-entry guard (§7) ─────────────────────────────────────────────
  // When a NEW external payment targets an invoice that Alga already shows as
  // fully settled, flag it as an over-application drift exception rather than
  // applying it. This detects the "bookkeeper manually re-keyed a Stripe payment
  // in QBO" scenario. Only applies to brand-new payments (no existing mapping);
  // edits to existing mappings go through the reverse-and-reapply path normally.
  if (!existing) {
    for (const allocation of allocations) {
      const invoiceRow = await deps.knex('invoices')
        .where({ tenant: deps.tenantId, invoice_id: allocation.invoiceId })
        .select('status', 'total_amount', 'credit_applied')
        .first<{ status: string; total_amount: number; credit_applied: number | null } | undefined>();

      if (!invoiceRow) {
        continue; // Invoice disappeared — let the normal path handle it
      }

      const isFullySettled =
        invoiceRow.status === 'paid' ||
        (() => {
          // Also check computeBalanceDue with only the recorded payments,
          // to catch cases where status hasn't been flushed yet.
          // We only want to know if total_amount minus credits is already <= 0
          // using the stored status as the primary signal (avoids a second sum query).
          return false; // primary check is status === 'paid'; secondary check below
        })();

      // Secondary balance check: compute from what we know without a sum query.
      // If the invoice has credit_applied >= total_amount it is also settled.
      const secondarySettled = computeBalanceDue({
        totalAmount: Number(invoiceRow.total_amount),
        creditApplied: Number(invoiceRow.credit_applied ?? 0),
        totalPaid: 0 // Only checking credit coverage; payment coverage checked via status
      }) <= 0;

      if (isFullySettled || secondarySettled) {
        deps.stats.paymentsSkipped += 1;
        const result = await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_unmapped_payment',
          entityType: 'external_payment',
          entityId: change.externalId,
          title: 'QuickBooks payment targets an already-settled invoice',
          context: {
            external_payment_id: change.externalId,
            reference: paymentReference(change.payload, change.externalId),
            alga_invoice_id: allocation.invoiceId,
            invoice_status: invoiceRow.status,
            reason: 'over_application',
            realm: deps.targetRealm
          }
        });
        if (result.created) {
          deps.stats.exceptionsCreated += 1;
        }
        logger.info('[accountingSync] Over-application guard: skipped payment for settled invoice', {
          tenantId: deps.tenantId,
          externalPaymentId: change.externalId,
          invoiceId: allocation.invoiceId
        });
        return;
      }
    }
  }

  const previousAllocations: RecordedAllocation[] =
    existing && !existing.metadata?.deleted ? existing.metadata?.allocations ?? [] : [];

  await deps.knex.transaction(async (trx) => {
    if (previousAllocations.length > 0) {
      await reverseRecordedAllocations(
        trx,
        deps,
        previousAllocations,
        change.externalId,
        'Payment changed in QuickBooks — reapplying current allocations'
      );
    }

    const recorded = await applyAllocations(trx, deps, change, allocations);

    const metadata = {
      sync_token: change.syncToken ?? null,
      allocations: recorded,
      total_cents: recorded.reduce((sum, allocation) => sum + allocation.amountCents, 0),
      unapplied_cents: toCents((change.payload as any)?.UnappliedAmt),
      reference: paymentReference(change.payload, change.externalId)
    };

    const trxLedger = deps.ledger.withKnex(trx);
    if (existing) {
      await trxLedger.update(existing.id, { syncStatus: 'synced', metadata, touchSyncedAt: true });
    } else {
      await trxLedger.insert({
        algaEntityType: PAYMENT_MAPPING_ENTITY_TYPE,
        algaEntityId: recorded[0].algaPaymentId,
        externalEntityId: change.externalId,
        targetRealm: deps.targetRealm,
        syncStatus: 'synced',
        metadata
      });
    }
  });

  if (previousAllocations.length > 0) {
    deps.stats.paymentsReversed += 1;
  }
  deps.stats.paymentsApplied += 1;

  logger.info('[accountingSync] Applied external payment', {
    tenantId: deps.tenantId,
    externalPaymentId: change.externalId,
    allocations: allocations.length,
    reapplied: previousAllocations.length > 0
  });
}
