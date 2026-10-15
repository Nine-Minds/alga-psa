import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- sync-engine applier bridges billing to the QuickBooks client only for the legacy (no-adapter) path
import { QboClientService } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { writeAccountingAudit } from '@alga-psa/db';
import type { AccountingExportAdapter, AccountingProviderOperations } from '@alga-psa/types';
import type { AccountingSyncCycleStats } from './accountingSync.types';
import { MAPPING_SYNC_STATUS } from './accountingSync.types';
import type { SyncOperationsRepository } from './syncOperationsRepository';
import type { SyncMappingLedger } from './syncMappingLedger';
import type { SyncExceptionService } from './syncExceptions.types';
import { adapterSupportsOutbound } from './normalizedChange';
import { failUnsupportedOperations } from './unsupportedOperations';

interface DrainDeps {
  knex: Knex;
  tenantId: string;
  adapterType: string;
  targetRealm: string;
  ops: SyncOperationsRepository;
  ledger: SyncMappingLedger;
  exceptions: SyncExceptionService;
  stats: AccountingSyncCycleStats;
  /** Adapter selected for this cycle; gates the outbound operation. */
  adapter?: AccountingExportAdapter;
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

  // ── Capability gate ──────────────────────────────────────────────────────
  if (!adapterSupportsOutbound(deps.adapter, deps.adapterType, 'void')) {
    await failUnsupportedOperations(deps, pending, {
      entityType: 'invoice',
      operationLabel: 'invoice void',
      providerLabel: deps.adapterType === 'xero' ? 'Xero' : deps.adapterType
    });
    return;
  }

  const providerOps: AccountingProviderOperations | null = deps.adapter?.providerOperations
    ? await deps.adapter.providerOperations(deps.tenantId, deps.targetRealm)
    : null;
  const providerLabel = deps.adapterType === 'xero' ? 'Xero' : 'QuickBooks';
  const auditProvider: 'xero' | 'quickbooks_online' =
    deps.adapterType === 'xero' ? 'xero' : 'quickbooks_online';

  // Only the QBO adapter may use the legacy direct-client path. A non-QBO
  // adapter without providerOperations must never fall back to QboClientService.
  if (!providerOps && deps.adapterType !== 'quickbooks_online') {
    await failUnsupportedOperations(deps, pending, {
      entityType: 'invoice',
      operationLabel: 'invoice void',
      providerLabel
    });
    return;
  }

  let qboClient: QboClientService | null = null;
  if (!providerOps) {
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
  }

  for (const op of pending) {
    // Exact tenant + provider + entity type + realm match, no NULL-realm
    // fallback, tombstones excluded: a mapping in another company or one that
    // was unlinked must never drive a void in this company.
    const mapping = await deps.ledger.findByAlgaId('invoice', op.alga_entity_id, deps.targetRealm);

    if (!mapping) {
      const blocked = await deps.ledger.findNonConsumable('invoice', op.alga_entity_id, deps.targetRealm);
      if (blocked) {
        const reason = blocked.deleted_at
          ? 'invoice was unlinked from the accounting provider'
          : 'invoice maps to a different accounting company';
        const message = `Cannot void in ${providerLabel}: ${reason}. Relink the invoice mapping to this company first.`;
        logger.warn('[invoiceVoidApplier] Void blocked by non-consumable mapping', {
          opId: op.op_id,
          tenantId: deps.tenantId,
          invoiceId: op.alga_entity_id,
          mappingId: blocked.id,
          deleted: Boolean(blocked.deleted_at),
          externalRealm: blocked.external_realm_id
        });
        const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
        deps.stats.opsFailed += 1;
        if (nextStatus === 'skipped') {
          await deps.exceptions.createOrUpdate({
            type: 'accounting_sync_export_error',
            entityType: 'invoice',
            entityId: op.alga_entity_id,
            title: 'Invoice void blocked — mapping is unlinked or points at another company',
            context: {
              alga_entity_id: op.alga_entity_id,
              external_entity_id: blocked.external_entity_id,
              attempts: op.attempts + 1,
              message,
              details:
                `${message} The remote document was not touched. ` +
                'Relink the invoice in the accounting mapping screen, then retry the void.',
              realm: deps.targetRealm
            }
          });
          deps.stats.exceptionsCreated += 1;
        }
        continue;
      }

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
    // The actor who voided the invoice in Alga (recorded on the op at enqueue
    // time by the void action). Null for legacy ops enqueued before this field
    // existed — the audit then records a system actor.
    const requestedByUserId: string | null =
      (op.payload as Record<string, unknown> | null)?.requestedByUserId as string | null ?? null;

    try {
      await deps.ops.markInProgress(deps.tenantId, op.op_id);

      // Read the current entity to get a fresh SyncToken
      const entity = providerOps
        ? await providerOps.readDocument(externalEntityType, externalId)
        : await qboClient!.read<any>(externalEntityType, externalId);
      if (!entity) {
        // Already deleted/voided in the provider — treat as done
        await deps.ledger.update(mapping.id, {
          syncStatus: MAPPING_SYNC_STATUS.voided,
          metadata: { ...(mapping.metadata ?? {}), voided_at: new Date().toISOString() }
        });
        await deps.ops.markDone(deps.tenantId, op.op_id);
        deps.stats.opsProcessed += 1;
        continue;
      }

      if (providerOps) {
        await providerOps.voidDocument({ externalId, externalEntityType });
      } else {
        const syncToken: string = String((entity as any).SyncToken ?? (entity as any).syncToken ?? '0');
        if (externalEntityType === 'CreditMemo') {
          await qboClient!.deleteCreditMemo(externalId, syncToken);
        } else {
          await qboClient!.voidInvoice(externalId, syncToken);
        }
      }

      await deps.ledger.update(mapping.id, {
        syncStatus: MAPPING_SYNC_STATUS.voided,
        metadata: { ...(mapping.metadata ?? {}), voided_at: new Date().toISOString() }
      });

      await deps.ops.markDone(deps.tenantId, op.op_id);
      deps.stats.opsProcessed += 1;

      logger.info('[invoiceVoidApplier] Invoice voided in accounting provider', {
        tenantId: deps.tenantId,
        invoiceId: op.alga_entity_id,
        externalId,
        externalEntityType
      });

      // Remote destructive operations are audited with no secret material:
      // only the provider, the remote entity, the outcome, and the actor who
      // requested the void.
      await writeAccountingAudit(deps.knex, deps.tenantId, 'accounting_remote_void', {
        userId: requestedByUserId ?? undefined,
        provider: auditProvider,
        recordId: externalId,
        details: {
          algaEntityType: 'invoice',
          algaEntityId: op.alga_entity_id,
          externalEntityType,
          operation: op.operation,
          outcome: 'voided',
          source: 'sync_cycle',
        },
      }).catch((error) => {
        logger.warn('[invoiceVoidApplier] Failed to write remote-void audit entry', {
          tenantId: deps.tenantId,
          error,
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `${providerLabel} void/delete failed`;
      logger.warn('[invoiceVoidApplier] Failed to void invoice in accounting provider', {
        opId: op.op_id,
        tenantId: deps.tenantId,
        externalId,
        error: message
      });
      const nextStatus = await deps.ops.markFailed(deps.tenantId, op.op_id, message);
      deps.stats.opsFailed += 1;

      // Record the failed remote-void attempt with the same actor as the
      // enqueue, so partial failures still leave an audit trail.
      await writeAccountingAudit(deps.knex, deps.tenantId, 'accounting_remote_void', {
        userId: requestedByUserId ?? undefined,
        provider: auditProvider,
        recordId: externalId,
        details: {
          algaEntityType: 'invoice',
          algaEntityId: op.alga_entity_id,
          externalEntityType,
          operation: op.operation,
          outcome: 'failed',
          error: message,
          source: 'sync_cycle',
        },
      }).catch((error) => {
        logger.warn('[invoiceVoidApplier] Failed to write remote-void failure audit entry', {
          tenantId: deps.tenantId,
          error,
        });
      });

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
