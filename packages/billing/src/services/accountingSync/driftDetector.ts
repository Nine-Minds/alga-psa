import logger from '@alga-psa/core/logger';
import type { AccountingExternalChange } from '@alga-psa/types';
import { SyncMappingLedger } from './syncMappingLedger';
import { MAPPING_SYNC_STATUS, type AccountingSyncCycleStats } from './accountingSync.types';
import type { SyncExceptionService } from './syncExceptions.types';

/**
 * Drift detection for exported documents (Invoices now; CreditMemos ride the
 * same path once slice 2 exports them — both map as alga_entity_type
 * 'invoice').
 *
 * The deliver() snapshot (exported_total, doc_number, sync_token) is the
 * baseline. Payments and credit applications in QBO bump an invoice's
 * SyncToken and Balance WITHOUT changing the total — that is not drift; the
 * stored token is just refreshed. Material drift = total changed, doc number
 * changed, or the document deleted/voided externally.
 */

export interface DriftDetectorDeps {
  tenantId: string;
  targetRealm: string;
  ledger: SyncMappingLedger;
  exceptions: SyncExceptionService;
  stats: AccountingSyncCycleStats;
}

function toAmount(value: unknown): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export async function applyExternalDocumentChange(
  deps: DriftDetectorDeps,
  change: AccountingExternalChange
): Promise<void> {
  const mapping = await deps.ledger.findByExternalId('invoice', change.externalId, deps.targetRealm);
  if (!mapping) {
    // Documents created directly in QBO are deliberately ignored.
    deps.stats.unmappedIgnored += 1;
    return;
  }

  const metadata = mapping.metadata ?? {};

  if (change.deleted) {
    if (mapping.sync_status === MAPPING_SYNC_STATUS.externalVoided) {
      return;
    }

    await deps.ledger.update(mapping.id, {
      syncStatus: MAPPING_SYNC_STATUS.externalVoided,
      metadata: { ...metadata, external_deleted_at: new Date().toISOString() }
    });
    deps.stats.driftFound += 1;

    const result = await deps.exceptions.createOrUpdate({
      type: 'accounting_sync_drift',
      entityType: 'invoice',
      entityId: mapping.alga_entity_id,
      title: 'Exported invoice was voided or deleted in QuickBooks',
      context: {
        alga_invoice_id: mapping.alga_entity_id,
        external_invoice_id: change.externalId,
        drift_kind: 'external_voided',
        alga_snapshot: {
          total: metadata.exported_total ?? null,
          doc_number: metadata.doc_number ?? null
        },
        realm: deps.targetRealm
      }
    });
    if (result.created) {
      deps.stats.exceptionsCreated += 1;
    }
    return;
  }

  // Our own deliveries echo back through change polling with the token we stored.
  if (change.syncToken !== undefined && change.syncToken === metadata.sync_token) {
    return;
  }

  const externalTotal = toAmount((change.payload as any)?.TotalAmt);
  const externalDocNumber = (change.payload as any)?.DocNumber ?? null;
  const snapshotTotal = toAmount(metadata.exported_total);
  const snapshotDocNumber = metadata.doc_number ?? null;

  const totalChanged =
    externalTotal !== null && snapshotTotal !== null && Math.abs(externalTotal - snapshotTotal) > 0.005;
  const docNumberChanged =
    externalDocNumber !== null && snapshotDocNumber !== null && String(externalDocNumber) !== String(snapshotDocNumber);

  if (!totalChanged && !docNumberChanged) {
    // Balance/payment churn only — refresh the stored token and move on.
    await deps.ledger.update(mapping.id, {
      metadata: { ...metadata, sync_token: change.syncToken ?? metadata.sync_token },
      touchSyncedAt: true
    });
    return;
  }

  await deps.ledger.update(mapping.id, {
    syncStatus: MAPPING_SYNC_STATUS.drift,
    metadata: {
      ...metadata,
      drift_detected_at: new Date().toISOString(),
      external_observed: {
        total: externalTotal,
        doc_number: externalDocNumber,
        sync_token: change.syncToken ?? null
      }
    }
  });
  deps.stats.driftFound += 1;

  const result = await deps.exceptions.createOrUpdate({
    type: 'accounting_sync_drift',
    entityType: 'invoice',
    entityId: mapping.alga_entity_id,
    title: 'Exported invoice was changed in QuickBooks',
    context: {
      alga_invoice_id: mapping.alga_entity_id,
      external_invoice_id: change.externalId,
      drift_kind: docNumberChanged && !totalChanged ? 'doc_number_changed' : 'total_changed',
      alga_snapshot: { total: snapshotTotal, doc_number: snapshotDocNumber },
      external_observed: { total: externalTotal, doc_number: externalDocNumber },
      realm: deps.targetRealm
    }
  });
  if (result.created) {
    deps.stats.exceptionsCreated += 1;
  }

  logger.info('[accountingSync] Drift detected on exported invoice', {
    tenantId: deps.tenantId,
    invoiceId: mapping.alga_entity_id,
    externalInvoiceId: change.externalId,
    totalChanged,
    docNumberChanged
  });
}
