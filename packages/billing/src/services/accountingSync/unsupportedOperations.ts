import logger from '@alga-psa/core/logger';
import type { AccountingSyncOperation, AccountingSyncCycleStats } from './accountingSync.types';
import type { SyncOperationsRepository } from './syncOperationsRepository';
import type { SyncExceptionService } from './syncExceptions.types';

export interface UnsupportedOperationGate {
  tenantId: string;
  adapterType: string;
  ops: Pick<SyncOperationsRepository, 'markFailedTerminal'>;
  exceptions: SyncExceptionService;
  stats: AccountingSyncCycleStats;
}

/**
 * Terminal outcome for an outbound operation an adapter cannot perform.
 *
 * The operation is not silently dropped and it is not retried forever: it is
 * marked `failed` (terminal) and an operator-visible exception is filed with
 * the reason and the adapter that refused it. This is the explicit
 * capability-gate path required for adapters such as Xero whose outbound
 * payment/credit/void writes are not implemented.
 */
export async function failUnsupportedOperations(
  gate: UnsupportedOperationGate,
  pending: AccountingSyncOperation[],
  params: {
    entityType: string;
    operationLabel: string;
    providerLabel: string;
  }
): Promise<void> {
  const message =
    `${params.providerLabel} does not support ${params.operationLabel} from Alga ` +
    `(adapter "${gate.adapterType}"). The operation was not sent to any provider.`;

  for (const op of pending) {
    await gate.ops.markFailedTerminal(gate.tenantId, op.op_id, message);
    gate.stats.opsFailed += 1;

    const result = await gate.exceptions.createOrUpdate({
      type: 'accounting_sync_export_error',
      entityType: params.entityType,
      entityId: op.alga_entity_id,
      title: `${params.operationLabel} is not supported by ${params.providerLabel}`,
      context: {
        reason: 'outbound_operation_unsupported',
        adapter_type: gate.adapterType,
        operation: op.operation,
        alga_entity_id: op.alga_entity_id,
        attempts: op.attempts + 1,
        message,
        details:
          `${message} No remote document was touched. This integration is export-only for now; ` +
          'perform the operation inside the accounting system, or remove the queued action.',
        realm: op.target_realm
      }
    });
    if (result.created) {
      gate.stats.exceptionsCreated += 1;
    }
  }

  logger.info('[accountingSync] Gated unsupported outbound operations', {
    tenantId: gate.tenantId,
    adapterType: gate.adapterType,
    operation: params.operationLabel,
    count: pending.length
  });
}
