import { Knex } from 'knex';
import type {
  AccountingSyncOperation,
  EnqueueSyncOperationInput,
  SyncOperationType
} from './accountingSync.types';

/** Failed ops retry until this many attempts, then become 'skipped' (terminal). */
export const MAX_OP_ATTEMPTS = 5;

const TABLE = 'accounting_sync_operations';

export class SyncOperationsRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Enqueue an operation. Deduplicates: while a pending op exists for the same
   * tenant + operation + entity, the existing op is returned instead of
   * inserting a duplicate.
   */
  async enqueue(input: EnqueueSyncOperationInput): Promise<AccountingSyncOperation> {
    const existing = await this.knex<AccountingSyncOperation>(TABLE)
      .where({
        tenant: input.tenant,
        adapter_type: input.adapterType,
        operation: input.operation,
        alga_entity_type: input.algaEntityType,
        alga_entity_id: input.algaEntityId,
        status: 'pending'
      })
      .first();

    if (existing) {
      return existing;
    }

    const [row] = await this.knex<AccountingSyncOperation>(TABLE)
      .insert({
        tenant: input.tenant,
        adapter_type: input.adapterType,
        target_realm: input.targetRealm ?? null,
        operation: input.operation,
        alga_entity_type: input.algaEntityType,
        alga_entity_id: input.algaEntityId,
        status: 'pending',
        attempts: 0,
        payload: input.payload ?? null
      })
      .returning('*');

    return row;
  }

  async listPending(
    tenant: string,
    adapterType: string,
    options: { operation?: SyncOperationType; targetRealm?: string | null; limit?: number } = {}
  ): Promise<AccountingSyncOperation[]> {
    const query = this.knex<AccountingSyncOperation>(TABLE)
      .where({ tenant, adapter_type: adapterType, status: 'pending' })
      .orderBy('created_at', 'asc');

    if (options.operation) {
      query.andWhere({ operation: options.operation });
    }
    if (options.targetRealm !== undefined) {
      query.andWhere((builder) => {
        builder.where('target_realm', options.targetRealm).orWhereNull('target_realm');
      });
    }
    if (options.limit) {
      query.limit(options.limit);
    }

    return query;
  }

  async markInProgress(tenant: string, opId: string): Promise<void> {
    await this.knex(TABLE)
      .where({ tenant, op_id: opId })
      .update({ status: 'in_progress' });
  }

  async markDone(tenant: string, opId: string): Promise<void> {
    await this.knex(TABLE)
      .where({ tenant, op_id: opId })
      .update({ status: 'done', processed_at: this.knex.fn.now(), last_error: null });
  }

  /**
   * Record a failure. Until MAX_OP_ATTEMPTS the op returns to 'pending' for the
   * next cycle; at the cap it becomes 'skipped' (terminal) and the caller files
   * an exception. Returns the resulting status.
   */
  async markFailed(tenant: string, opId: string, error: string): Promise<'pending' | 'skipped'> {
    const row = await this.knex<AccountingSyncOperation>(TABLE)
      .where({ tenant, op_id: opId })
      .first();

    const attempts = (row?.attempts ?? 0) + 1;
    const nextStatus = attempts >= MAX_OP_ATTEMPTS ? 'skipped' : 'pending';

    await this.knex(TABLE)
      .where({ tenant, op_id: opId })
      .update({
        status: nextStatus,
        attempts,
        last_error: error,
        processed_at: nextStatus === 'skipped' ? this.knex.fn.now() : null
      });

    return nextStatus;
  }

  /**
   * Mark pending ops done because the work happened elsewhere (e.g. a manual
   * export batch covered queued invoice exports). Returns affected count.
   */
  async satisfyPending(
    tenant: string,
    adapterType: string,
    operation: SyncOperationType,
    algaEntityIds: string[]
  ): Promise<number> {
    if (algaEntityIds.length === 0) {
      return 0;
    }

    return this.knex(TABLE)
      .where({ tenant, adapter_type: adapterType, operation, status: 'pending' })
      .whereIn('alga_entity_id', algaEntityIds)
      .update({ status: 'done', processed_at: this.knex.fn.now(), last_error: null });
  }

  async countByStatus(tenant: string, adapterType: string): Promise<Record<string, number>> {
    const rows = await this.knex(TABLE)
      .where({ tenant, adapter_type: adapterType })
      .select('status')
      .count<{ status: string; count: string }[]>('* as count')
      .groupBy('status');

    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }
}
