import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { AppError } from '@alga-psa/core';
import { tenantDb } from '@alga-psa/db';
import type {
  AccountingChangeSet,
  AccountingExportAdapter,
  AccountingExportBatch,
  AccountingExternalChange
} from '@alga-psa/types';
import {
  emptyCycleStats,
  MAPPING_SYNC_STATUS,
  type AccountingSyncOperation,
  type AccountingSyncCycleStats
} from './accountingSync.types';
import { SyncCycleRepository } from './syncCycleRepository';
import { SyncOperationsRepository } from './syncOperationsRepository';
import { SyncMappingLedger } from './syncMappingLedger';
import { applyExternalPaymentChange } from './paymentApplier';
import { applyExternalCustomerChange } from './customerApplier';
import { applyExternalDocumentChange } from './driftDetector';
import { getAccountingSyncSettings } from './accountingSyncSettings';
import { WorkflowTaskSyncExceptionService } from './syncExceptionService';
import type { SyncExceptionService } from './syncExceptions.types';
import {
  DefaultSyncNotificationService,
  resolveTokenThresholdToAnnounce,
  type SyncNotificationService
} from './syncNotificationService';
import { AccountingExportInvoiceSelector } from '../accountingExportInvoiceSelector';
import { AccountingExportService } from '../accountingExportService';
import { drainApplyCreditOps } from './creditApplicationApplier';
import { drainVoidInvoiceOps } from './invoiceVoidApplier';
import { drainRecordPaymentOps } from './paymentPushApplier';
import { ADAPTER_EXPORT_CAPABILITIES } from '../../adapters/accounting/registry';

/**
 * One accounting sync cycle for a tenant×realm:
 *
 *   token health → inbound (customers → payments → document drift)
 *               → outbound drain (scheduled batch through the export pipeline)
 *               → cursor advance
 *
 * The cursor only advances when inbound application succeeds; outbound
 * failures retry per-op with capped attempts and never block the cursor.
 * All appliers are idempotent against the mapping ledger, which is what makes
 * the deliberate cursor overlap (and our own outbound echoes) safe.
 */

/** Overlap subtracted from the stored cursor to absorb clock skew. */
export const CURSOR_OVERLAP_MS = 5 * 60 * 1000;

const AUTH_ERROR_CODES = new Set(['QBO_AUTH_ERROR', 'QBO_REFRESH_FAILED', 'QBO_SETUP_INCOMPLETE']);

function adapterSupportsExportType(adapterType: string, exportType: string): boolean {
  const capabilities = ADAPTER_EXPORT_CAPABILITIES as Record<string, readonly string[] | undefined>;
  return Boolean(capabilities[adapterType]?.includes(exportType));
}

export interface RunCycleParams {
  knex: Knex;
  tenantId: string;
  adapterType: string;
  targetRealm: string;
  adapter: AccountingExportAdapter;
  /** From the stored connection; drives the expiry countdown notifications. */
  refreshTokenExpiresAt?: string | null;
  /** Sync-now runs even when the tenant's auto-sync toggle is off. */
  force?: boolean;
  exceptions?: SyncExceptionService;
  notifications?: SyncNotificationService;
  now?: () => Date;
}

export interface RunCycleResult {
  ran: boolean;
  status: 'succeeded' | 'failed' | 'aborted' | 'skipped';
  cycleId?: string;
  stats?: AccountingSyncCycleStats;
  error?: string;
}

function isAuthError(error: unknown): boolean {
  return error instanceof AppError && AUTH_ERROR_CODES.has(error.code);
}

export async function runAccountingSyncCycle(params: RunCycleParams): Promise<RunCycleResult> {
  const now = params.now ?? (() => new Date());
  const { knex, tenantId, adapterType, targetRealm } = params;

  if (!params.adapter.capabilities().supportsChangePolling || !params.adapter.fetchChanges) {
    return { ran: false, status: 'skipped', error: 'adapter does not support change polling' };
  }

  const settings = await getAccountingSyncSettings(knex, tenantId);
  if (!settings.autoSyncEnabled && !params.force) {
    return { ran: false, status: 'skipped' };
  }

  const cycles = new SyncCycleRepository(knex);
  const ops = new SyncOperationsRepository(knex);
  const ledger = new SyncMappingLedger(knex, tenantId, adapterType);
  const exceptions = params.exceptions ?? new WorkflowTaskSyncExceptionService(knex, tenantId);
  const notifications = params.notifications ?? new DefaultSyncNotificationService(knex, tenantId);
  const stats = emptyCycleStats();

  // First run starts at "now": connecting must never import history — the
  // onboarding wizard (slice 3) is the deliberate path for that.
  const lastCursor = await cycles.getLastSuccessfulCursor(tenantId, adapterType, targetRealm);
  const since = lastCursor
    ? new Date(new Date(lastCursor).getTime() - CURSOR_OVERLAP_MS).toISOString()
    : new Date(now().getTime() - CURSOR_OVERLAP_MS).toISOString();

  const cycleId = await cycles.startCycle({
    tenant: tenantId,
    adapterType,
    targetRealm,
    cursorBefore: since
  });

  // Token expiry countdown (14/7/2 days, each announced once).
  try {
    const threshold = await resolveTokenThresholdToAnnounce(
      knex,
      tenantId,
      targetRealm,
      params.refreshTokenExpiresAt,
      now()
    );
    if (threshold !== null && params.refreshTokenExpiresAt) {
      const daysLeft = Math.max(
        1,
        Math.ceil((new Date(params.refreshTokenExpiresAt).getTime() - now().getTime()) / (24 * 60 * 60 * 1000))
      );
      await notifications.notifyTokenExpiring(targetRealm, daysLeft, threshold);
    }
  } catch (error) {
    logger.warn('[accountingSync] Token expiry check failed', {
      tenantId,
      targetRealm,
      error: error instanceof Error ? error.message : error
    });
  }

  // ── Inbound ────────────────────────────────────────────────────────────
  let changeSet: AccountingChangeSet;
  try {
    changeSet = await params.adapter.fetchChanges(tenantId, since, targetRealm);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'change polling failed';

    if (isAuthError(error)) {
      const result = await exceptions.createOrUpdate({
        type: 'accounting_connection_expired',
        entityType: 'connection',
        entityId: `${adapterType}:${targetRealm}`,
        title: 'Accounting connection failed authentication',
        context: { adapter_type: adapterType, realm: targetRealm, message, details: message }
      });
      if (result.created) {
        stats.exceptionsCreated += 1;
        await notifications.notifyConnectionExpired(targetRealm, message);
      }
      await cycles.finishCycle(tenantId, cycleId, { status: 'aborted', stats, error: message });
      return { ran: true, status: 'aborted', cycleId, stats, error: message };
    }

    await cycles.finishCycle(tenantId, cycleId, { status: 'failed', stats, error: message });
    return { ran: true, status: 'failed', cycleId, stats, error: message };
  }

  stats.truncated = changeSet.truncated;

  try {
    const byType = (entityType: AccountingExternalChange['entityType']) =>
      changeSet.changes.filter((change) => change.entityType === entityType);

    for (const change of byType('Customer')) {
      await applyExternalCustomerChange({ tenantId, targetRealm, ledger, exceptions, stats }, change);
    }

    for (const change of byType('Payment')) {
      await applyExternalPaymentChange(
        { knex, tenantId, adapterType, targetRealm, ledger, exceptions, stats },
        change
      );
    }

    for (const change of [...byType('Invoice'), ...byType('CreditMemo')]) {
      await applyExternalDocumentChange({ tenantId, targetRealm, ledger, exceptions, stats }, change);
    }

    stats.refundReceiptsSeen += byType('RefundReceipt').length;
  } catch (error) {
    // Inbound application failed: do not advance the cursor; the overlap +
    // idempotent appliers make the retry safe next cycle.
    const message = error instanceof Error ? error.message : 'inbound application failed';
    await cycles.finishCycle(tenantId, cycleId, { status: 'failed', stats, error: message });
    logger.error('[accountingSync] Cycle inbound failed', { tenantId, targetRealm, error: message });
    return { ran: true, status: 'failed', cycleId, stats, error: message };
  }

  // ── Outbound ───────────────────────────────────────────────────────────
  try {
    await drainExportInvoiceOps({ knex, tenantId, adapterType, targetRealm, ops, ledger, exceptions, stats });
    if (adapterSupportsExportType(adapterType, 'vendor_bill')) {
      await drainExportVendorBillOps({ knex, tenantId, adapterType, targetRealm, ops, ledger, exceptions, stats });
    }
  } catch (error) {
    // Outbound problems never block the cursor; per-op state handles retries.
    logger.error('[accountingSync] Outbound drain error', {
      tenantId,
      targetRealm,
      error: error instanceof Error ? error.message : error
    });
  }

  // ── Credit application (runs after exports so both CreditMemo and Invoice ──
  // ── mappings are available for the Payment-linking step)               ──
  try {
    await drainApplyCreditOps({ knex, tenantId, adapterType, targetRealm, ops, ledger, exceptions, stats });
  } catch (error) {
    logger.error('[accountingSync] Credit-application drain error', {
      tenantId,
      targetRealm,
      error: error instanceof Error ? error.message : error
    });
  }

  // ── Void invoice ops ────────────────────────────────────────────────────
  try {
    await drainVoidInvoiceOps({ knex, tenantId, adapterType, targetRealm, ops, ledger, exceptions, stats });
  } catch (error) {
    logger.error('[accountingSync] Void-invoice drain error', {
      tenantId,
      targetRealm,
      error: error instanceof Error ? error.message : error
    });
  }

  // ── Outbound payment push (Stripe → QBO) ────────────────────────────────
  try {
    await drainRecordPaymentOps({ knex, tenantId, adapterType, targetRealm, ops, ledger, exceptions, stats });
  } catch (error) {
    logger.error('[accountingSync] Record-payment drain error', {
      tenantId,
      targetRealm,
      error: error instanceof Error ? error.message : error
    });
  }

  if (stats.exceptionsCreated > 0) {
    try {
      await notifications.notifyNewExceptions(targetRealm, stats.exceptionsCreated);
    } catch (error) {
      logger.warn('[accountingSync] Exception summary notification failed', {
        tenantId,
        error: error instanceof Error ? error.message : error
      });
    }
  }

  await cycles.finishCycle(tenantId, cycleId, {
    status: 'succeeded',
    cursorAfter: changeSet.fetchedAt,
    stats
  });

  logger.info('[accountingSync] Cycle complete', { tenantId, targetRealm, cycleId, stats });
  return { ran: true, status: 'succeeded', cycleId, stats };
}

interface DrainDeps {
  knex: Knex;
  tenantId: string;
  adapterType: string;
  targetRealm: string;
  ops: SyncOperationsRepository;
  ledger: SyncMappingLedger;
  exceptions: SyncExceptionService;
  stats: AccountingSyncCycleStats;
}

/**
 * Drain pending export_invoice and export_credit_memo ops into one scheduled
 * batch through the existing validate→transform→deliver pipeline, so scheduled
 * and manual exports share one code path, error surface, and audit trail.
 */
async function drainExportInvoiceOps(deps: DrainDeps): Promise<void> {
  const [invoiceOps, creditMemoOps] = await Promise.all([
    deps.ops.listPending(deps.tenantId, deps.adapterType, {
      operation: 'export_invoice',
      targetRealm: deps.targetRealm
    }),
    deps.ops.listPending(deps.tenantId, deps.adapterType, {
      operation: 'export_credit_memo',
      targetRealm: deps.targetRealm
    })
  ]);
  const pending = [...invoiceOps, ...creditMemoOps];

  if (pending.length === 0) {
    return;
  }

  for (const op of pending) {
    await deps.ops.markInProgress(deps.tenantId, op.op_id);
  }

  const invoiceIds = Array.from(new Set(pending.map((op) => op.alga_entity_id)));

  let batchId: string | null = null;
  try {
    const batch = await createScheduledBatch(deps, invoiceIds);
    batchId = batch.batch_id;

    const exportService = await AccountingExportService.createForTenant(deps.tenantId);

    await exportService.executeBatch(batch.batch_id);

    for (const op of pending) {
      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;

      // The export landed, so any earlier export-failure exception is moot.
      await deps.exceptions.resolve('accounting_sync_export_error', 'invoice', op.alga_entity_id);

      // Re-exported drifted invoices are back in agreement. The deliver step may
      // already have reset the mapping to synced, so resolve unconditionally —
      // resolving without an open task is a no-op.
      const mapping = await deps.ledger.findByAlgaId('invoice', op.alga_entity_id);
      if (
        mapping &&
        (mapping.sync_status === MAPPING_SYNC_STATUS.drift ||
          mapping.sync_status === MAPPING_SYNC_STATUS.externalVoided)
      ) {
        await deps.ledger.update(mapping.id, { syncStatus: MAPPING_SYNC_STATUS.synced, touchSyncedAt: true });
      }
      await deps.exceptions.resolve('accounting_sync_drift', 'invoice', op.alga_entity_id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'scheduled export failed';

    if (error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_EMPTY_BATCH') {
      // Everything queued was already exported — the ops are satisfied.
      await cancelScheduledBatchIfBlocking(deps, batchId);
      for (const op of pending) {
        await deps.ops.markDone(deps.tenantId, op.op_id);
        deps.stats.opsProcessed += 1;
      }
      return;
    }

    // A failed scheduled batch must not survive in a status that trips the
    // duplicate-selection guard, or every later drain for these invoices dies
    // on "batch already exists" without ever re-attempting the export.
    await cancelScheduledBatchIfBlocking(deps, batchId);

    // Validation failures are deterministic — retrying cannot fix a missing
    // mapping — so the exception is filed on the first failure instead of
    // after the attempts cap. Dedupe keeps repeat cycles from spamming the
    // inbox. Transient errors (network, rate limits, 5xx) keep the
    // retry-then-alert shape.
    const isValidationFailure =
      error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_VALIDATION_FAILED';
    const validationErrors =
      isValidationFailure && Array.isArray((error.details as any)?.validationErrors)
        ? ((error.details as any).validationErrors as Array<{ code: string; message: string }>)
        : undefined;

    for (const op of pending) {
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;

      if (isValidationFailure || nextStatus === 'skipped') {
        const result = await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'invoice',
          entityId: op.alga_entity_id,
          title: isValidationFailure
            ? 'Scheduled accounting export failed validation'
            : 'Scheduled accounting export keeps failing',
          context: {
            alga_invoice_id: op.alga_entity_id,
            batch_id: batchId,
            attempts: op.attempts + 1,
            message,
            details: validationErrors?.length
              ? validationErrors.map((item) => `${item.code}: ${item.message}`).join('\n')
              : message,
            realm: deps.targetRealm
          }
        });
        if (result.created) {
          deps.stats.exceptionsCreated += 1;
        }
      }
    }

    logger.warn('[accountingSync] Scheduled export batch failed', {
      tenantId: deps.tenantId,
      targetRealm: deps.targetRealm,
      batchId,
      invoiceCount: invoiceIds.length,
      error: message
    });
  }
}

type VendorBillExportRow = {
  bill_id: string;
  bill_number: string;
  total_amount: string | number | null;
  currency_code: string | null;
};

async function drainExportVendorBillOps(deps: DrainDeps): Promise<void> {
  const pending = await deps.ops.listPending(deps.tenantId, deps.adapterType, {
    operation: 'export_vendor_bill',
    targetRealm: deps.targetRealm
  });

  if (pending.length === 0) {
    return;
  }

  for (const op of pending) {
    await deps.ops.markInProgress(deps.tenantId, op.op_id);
  }

  const remaining: AccountingSyncOperation[] = [];
  for (const op of pending) {
    const mapping = await deps.ledger.findByAlgaId('vendor_bill', op.alga_entity_id);
    if (mapping) {
      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;
      await deps.exceptions.resolve('accounting_sync_export_error', 'vendor_bill', op.alga_entity_id);
      continue;
    }
    remaining.push(op);
  }

  if (remaining.length === 0) {
    return;
  }

  const billIds = Array.from(new Set(remaining.map((op) => op.alga_entity_id)));
  let batchId: string | null = null;

  try {
    const batch = await createScheduledVendorBillBatch(deps, billIds);
    batchId = batch.batch_id;

    const exportService = await AccountingExportService.createForTenant(deps.tenantId);
    await exportService.executeBatch(batch.batch_id);

    for (const op of remaining) {
      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;
      await deps.exceptions.resolve('accounting_sync_export_error', 'vendor_bill', op.alga_entity_id);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'scheduled vendor bill export failed';

    if (error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_EMPTY_BATCH') {
      await cancelScheduledBatchIfBlocking(deps, batchId);
      for (const op of remaining) {
        await deps.ops.markDone(deps.tenantId, op.op_id);
        deps.stats.opsProcessed += 1;
      }
      return;
    }

    await cancelScheduledBatchIfBlocking(deps, batchId);

    const isValidationFailure =
      error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_VALIDATION_FAILED';
    const validationErrors =
      isValidationFailure && Array.isArray((error.details as any)?.validationErrors)
        ? ((error.details as any).validationErrors as Array<{ code: string; message: string }>)
        : undefined;

    for (const op of remaining) {
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;

      if (isValidationFailure || nextStatus === 'skipped') {
        const result = await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'vendor_bill',
          entityId: op.alga_entity_id,
          title: isValidationFailure
            ? 'Scheduled vendor bill export failed validation'
            : 'Scheduled vendor bill export keeps failing',
          context: {
            alga_vendor_bill_id: op.alga_entity_id,
            batch_id: batchId,
            attempts: op.attempts + 1,
            message,
            details: validationErrors?.length
              ? validationErrors.map((item) => `${item.code}: ${item.message}`).join('\n')
              : message,
            realm: deps.targetRealm
          }
        });
        if (result.created) {
          deps.stats.exceptionsCreated += 1;
        }
      }
    }

    logger.warn('[accountingSync] Scheduled vendor bill export batch failed', {
      tenantId: deps.tenantId,
      targetRealm: deps.targetRealm,
      batchId,
      billCount: billIds.length,
      error: message
    });
  }
}

/**
 * Create the scheduled batch, recovering once from a wedged predecessor: if
 * the duplicate-selection guard points at an engine-owned scheduled batch
 * that a previous failed drain left behind, cancel it and retry — operators
 * fix the underlying problem (e.g. restore a mapping), and the next drain
 * must be able to try the export again. Manual batches are operator-owned
 * and never auto-cancelled.
 */
async function createScheduledBatch(deps: DrainDeps, invoiceIds: string[]): Promise<AccountingExportBatch> {
  const selector = new AccountingExportInvoiceSelector(deps.knex, deps.tenantId);
  const createOptions = {
    adapterType: deps.adapterType,
    targetRealm: deps.targetRealm,
    origin: 'scheduled' as const,
    notes: 'Scheduled accounting sync',
    filters: {
      invoiceIds,
      // Re-exports (drift resolution) must not be filtered out as already-synced.
      excludeSyncedInvoices: false
    }
  };

  try {
    const { batch } = await selector.createBatchFromFilters(createOptions);
    return batch;
  } catch (error) {
    const staleBatchId =
      error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_DUPLICATE'
        ? ((error.details as any)?.batchId as string | undefined)
        : undefined;
    if (!staleBatchId) {
      throw error;
    }

    const cancelled = await cancelScheduledBatchIfBlocking(deps, staleBatchId);
    if (!cancelled) {
      throw error;
    }

    const { batch } = await selector.createBatchFromFilters(createOptions);
    return batch;
  }
}

async function createScheduledVendorBillBatch(deps: DrainDeps, billIds: string[]): Promise<AccountingExportBatch> {
  const db = tenantDb(deps.knex, deps.tenantId);
  const bills = (await db.table<VendorBillExportRow>('vendor_bills')
    .whereIn('bill_id', billIds)
    .select('bill_id', 'bill_number', 'total_amount', 'currency_code')) as VendorBillExportRow[];

  if (bills.length !== billIds.length) {
    const found = new Set(bills.map((bill) => bill.bill_id));
    const missing = billIds.filter((billId) => !found.has(billId));
    throw new AppError('VENDOR_BILL_EXPORT_BILL_NOT_FOUND', 'One or more vendor bills no longer exist', {
      missingBillIds: missing
    });
  }

  const exportService = await AccountingExportService.createForTenant(deps.tenantId);
  const createOptions = {
    adapter_type: deps.adapterType,
    target_realm: deps.targetRealm,
    export_type: 'vendor_bill',
    origin: 'scheduled' as const,
    notes: 'Scheduled vendor bill accounting sync',
    filters: {
      billIds
    }
  };

  let batch: AccountingExportBatch;
  try {
    batch = await exportService.createBatch(createOptions);
  } catch (error) {
    const staleBatchId =
      error instanceof AppError && error.code === 'ACCOUNTING_EXPORT_DUPLICATE'
        ? ((error.details as any)?.batchId as string | undefined)
        : undefined;
    if (!staleBatchId) {
      throw error;
    }

    const cancelled = await cancelScheduledBatchIfBlocking(deps, staleBatchId);
    if (!cancelled) {
      throw error;
    }
    batch = await exportService.createBatch(createOptions);
  }

  await exportService.appendLines(batch.batch_id, {
    lines: bills.map((bill) => ({
      batch_id: batch.batch_id,
      document_id: bill.bill_id,
      document_line_id: null,
      client_id: null,
      amount_cents: Math.round(Number(bill.total_amount ?? 0)),
      currency_code: bill.currency_code ?? 'USD',
      payload: {
        document_number: bill.bill_number,
        document_kind: 'vendor_bill'
      }
    }))
  });

  return batch;
}

/**
 * Cancel an engine-owned scheduled batch if it sits in a status the
 * duplicate-selection guard treats as blocking. Returns true when the batch
 * was cancelled. The batch (and its validation errors) stays readable in the
 * exports UI as a historical record.
 */
async function cancelScheduledBatchIfBlocking(deps: DrainDeps, batchId: string | null): Promise<boolean> {
  if (!batchId) {
    return false;
  }

  try {
    const exportService = await AccountingExportService.createForTenant(deps.tenantId);
    const { batch } = await exportService.getBatchWithDetails(batchId);
    if (!batch || batch.origin !== 'scheduled') {
      return false;
    }

    const blocking: Array<AccountingExportBatch['status']> = ['pending', 'validating', 'needs_attention', 'ready'];
    if (!blocking.includes(batch.status)) {
      return false;
    }

    await exportService.cancelBatch(batchId, {
      reason: 'Auto-cancelled by scheduled sync: batch did not deliver and would block future scheduled exports'
    });
    return true;
  } catch (error) {
    logger.warn('[accountingSync] Failed to auto-cancel scheduled export batch', {
      tenantId: deps.tenantId,
      batchId,
      error: error instanceof Error ? error.message : error
    });
    return false;
  }
}
