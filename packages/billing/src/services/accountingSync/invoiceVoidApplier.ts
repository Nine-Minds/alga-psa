import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import type { AccountingSyncCycleStats } from './accountingSync.types';
import { MAPPING_SYNC_STATUS } from './accountingSync.types';
import type { SyncOperationsRepository } from './syncOperationsRepository';
import type { SyncMappingLedger } from './syncMappingLedger';
import type { SyncExceptionService } from './syncExceptions.types';

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
 * Drain pending void_invoice ops.
 *
 * For each op:
 *   - Look up invoice mapping; if missing → markDone (nothing to void)
 *   - Create QboClientService for the realm
 *   - Read current entity (Invoice or CreditMemo based on mapping metadata.external_entity_type)
 *     to get fresh SyncToken
 *   - Call voidInvoice or deleteCreditMemo
 *   - Update mapping sync_status → 'voided', metadata.voided_at → now
 *   - markDone
 *   - On failure → markFailed
 */
export async function drainVoidInvoiceOps(deps: DrainDeps): Promise<void> {
  const pending = await deps.ops.listPending(deps.tenantId, deps.adapterType, {
    operation: 'void_invoice',
    targetRealm: deps.targetRealm
  });

  if (pending.length === 0) {
    return;
  }

  let qboClient: QboClientService | null = null;
  try {
    qboClient = await QboClientService.create(deps.tenantId, deps.targetRealm);
  } catch (error) {
    logger.warn('[invoiceVoidApplier] Cannot create QBO client; leaving void_invoice ops pending', {
      tenantId: deps.tenantId,
      targetRealm: deps.targetRealm,
      error: error instanceof Error ? error.message : error
    });
    return;
  }

  for (const op of pending) {
    const mapping = await deps.ledger.findByAlgaId('invoice', op.alga_entity_id);

    if (!mapping) {
      // Nothing to void in QBO — the invoice was never exported
      logger.debug('[invoiceVoidApplier] No mapping found; marking done', {
        opId: op.op_id,
        invoiceId: op.alga_entity_id
      });
      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;
      continue;
    }

    // Already voided — idempotent
    if (mapping.sync_status === MAPPING_SYNC_STATUS.voided) {
      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;
      continue;
    }

    const externalEntityType: string =
      (mapping.metadata as any)?.external_entity_type ?? 'Invoice';
    const externalId = mapping.external_entity_id;

    try {
      await deps.ops.markInProgress(deps.tenantId, op.op_id);

      // Read the current entity to get a fresh SyncToken
      const entity = await qboClient.read<any>(externalEntityType, externalId);
      if (!entity) {
        // Already deleted/voided in QBO — treat as done
        await deps.ledger.update(mapping.id, {
          syncStatus: MAPPING_SYNC_STATUS.voided,
          metadata: { ...(mapping.metadata ?? {}), voided_at: new Date().toISOString() }
        });
        await deps.ops.markDone(deps.tenantId, op.op_id);
        deps.stats.opsProcessed += 1;
        continue;
      }

      const syncToken: string = String(entity.SyncToken ?? entity.syncToken ?? '0');

      if (externalEntityType === 'CreditMemo') {
        await qboClient.deleteCreditMemo(externalId, syncToken);
      } else {
        await qboClient.voidInvoice(externalId, syncToken);
      }

      await deps.ledger.update(mapping.id, {
        syncStatus: MAPPING_SYNC_STATUS.voided,
        metadata: { ...(mapping.metadata ?? {}), voided_at: new Date().toISOString() }
      });

      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;

      logger.info('[invoiceVoidApplier] Invoice voided in QBO', {
        tenantId: deps.tenantId,
        invoiceId: op.alga_entity_id,
        externalId,
        externalEntityType
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'QBO void/delete failed';
      logger.warn('[invoiceVoidApplier] Failed to void invoice in QBO', {
        opId: op.op_id,
        tenantId: deps.tenantId,
        externalId,
        error: message
      });
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;

      if (nextStatus === 'skipped') {
        await deps.exceptions.createOrUpdate({
          type: 'accounting_sync_export_error',
          entityType: 'invoice',
          entityId: op.alga_entity_id,
          title: 'Invoice void keeps failing in accounting',
          context: {
            alga_entity_id: op.alga_entity_id,
            external_entity_id: externalId,
            attempts: op.attempts + 1,
            message,
            details: message,
            realm: deps.targetRealm
          }
        });
        deps.stats.exceptionsCreated += 1;
      }
    }
  }
}
