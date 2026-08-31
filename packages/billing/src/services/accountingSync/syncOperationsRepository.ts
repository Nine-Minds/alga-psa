import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
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

  private table<Row extends object = Record<string, unknown>>(tenant: string) {
    return tenantDb(this.knex, tenant).table<Row>(TABLE);
  }

  /**
   * Enqueue an operation. Deduplicates: while a pending op exists for the same
   * tenant + operation + entity + target realm, the existing op is returned
   * instead of inserting a duplicate. The realm is part of the identity — the
   * same local entity queued against two QuickBooks companies is two distinct
   * operations, never collapsed into one.
   */
  async enqueue(input: EnqueueSyncOperationInput): Promise<AccountingSyncOperation> {
    // Atomic, idempotent enqueue. The partial unique index
    // `accounting_sync_operations_pending_unique` guarantees at most one pending
    // op per (tenant, adapter, operation, entity, realm). Rather than SELECT then
    // INSERT — which races: two concurrent callers both see no existing row and
    // the loser's INSERT hits the unique constraint — we INSERT ... ON CONFLICT
    // DO NOTHING and, on conflict, reuse the winner's pending row. Both callers
    // return the same single pending operation; neither throws.
    const inserted = await this.table<AccountingSyncOperation>(input.tenant)
      .insert({
        tenant: input.tenant,
        adapter_type: input.adapterType,
        target_realm: input.targetRealm,
        operation: input.operation,
        alga_entity_type: input.algaEntityType,
        alga_entity_id: input.algaEntityId,
        status: 'pending',
        attempts: 0,
        payload: input.payload ?? null
      })
      // Match the partial expression index exactly (columns, COALESCE, predicate)
      // so Postgres uses it as the conflict arbiter.
      .onConflict(
        this.knex.raw(
          "(tenant, adapter_type, operation, alga_entity_type, alga_entity_id, COALESCE(target_realm, '')) WHERE status = 'pending'"
        ) as unknown as string
      )
      .ignore()
      .returning('*');

    if (inserted.length > 0) {
      return inserted[0];
    }

    // Lost the race (or a pending op already existed): the INSERT was a no-op.
    // The conflicting row is committed by the time this statement returns, so
    // reuse it. This is the deduplication contract.
    const existing = await this.findExistingPending(input);
    if (existing) {
      return existing;
    }

    // Defensive: the pending row changed status between our INSERT and this
    // SELECT (e.g. it was picked up and marked in_progress). Retry the insert
    // once — there is now no pending row to conflict with.
    const [retry] = await this.table<AccountingSyncOperation>(input.tenant)
      .insert({
        tenant: input.tenant,
        adapter_type: input.adapterType,
        target_realm: input.targetRealm,
        operation: input.operation,
        alga_entity_type: input.algaEntityType,
        alga_entity_id: input.algaEntityId,
        status: 'pending',
        attempts: 0,
        payload: input.payload ?? null
      })
      .onConflict(
        this.knex.raw(
          "(tenant, adapter_type, operation, alga_entity_type, alga_entity_id, COALESCE(target_realm, '')) WHERE status = 'pending'"
        ) as unknown as string
      )
      .ignore()
      .returning('*');

    if (retry) {
      return retry;
    }

    // A new pending row raced in during the retry window; return it.
    const afterRetry = await this.findExistingPending(input);
    if (afterRetry) {
      return afterRetry;
    }

    throw new Error(
      `Failed to enqueue accounting sync operation for entity ${input.algaEntityId} (${input.operation}) in realm ${String(input.targetRealm)}: no row was inserted and none is pending.`
    );
  }

  private async findExistingPending(
    input: EnqueueSyncOperationInput
  ): Promise<AccountingSyncOperation | undefined> {
    const query = this.table<AccountingSyncOperation>(input.tenant)
      .where({
        adapter_type: input.adapterType,
        operation: input.operation,
        alga_entity_type: input.algaEntityType,
        alga_entity_id: input.algaEntityId,
        status: 'pending'
      });

    // Match the index's COALESCE(target_realm, '') semantics so a null realm
    // is looked up correctly rather than via `= NULL` (which never matches).
    if (input.targetRealm === null || input.targetRealm === undefined) {
      query.whereNull('target_realm');
    } else {
      query.andWhere({ target_realm: input.targetRealm });
    }

    return query.first();
  }

  async listPending(
    tenant: string,
    adapterType: string,
    options: { operation?: SyncOperationType; targetRealm?: string; limit?: number } = {}
  ): Promise<AccountingSyncOperation[]> {
    const query = this.table<AccountingSyncOperation>(tenant)
      .where({ adapter_type: adapterType, status: 'pending' })
      .orderBy('created_at', 'asc');

    if (options.operation) {
      query.andWhere({ operation: options.operation });
    }
    if (options.targetRealm !== undefined) {
      // Realm-exact: an operation was enqueued against one immutable target
      // realm and may only drain in a cycle for that same realm. Legacy
      // null-realm ops never match; migration backfills or retires them.
      query.andWhere({ target_realm: options.targetRealm });
    }
    if (options.limit) {
      query.limit(options.limit);
    }

    return query;
  }

  async markInProgress(tenant: string, opId: string): Promise<void> {
    await this.table(tenant)
      .where({ op_id: opId })
      .update({ status: 'in_progress' });
  }

  async markDone(tenant: string, opId: string): Promise<void> {
    await this.table(tenant)
      .where({ op_id: opId })
      .update({ status: 'done', processed_at: this.knex.fn.now(), last_error: null });
  }

  /**
   * Record a failure. Until MAX_OP_ATTEMPTS the op returns to 'pending' for the
   * next cycle; at the cap it becomes 'skipped' (terminal) and the caller files
   * an exception. Returns the resulting status.
   */
  async markFailed(tenant: string, opId: string, error: string): Promise<'pending' | 'skipped'> {
    const row = await this.table<AccountingSyncOperation>(tenant)
      .where({ op_id: opId })
      .first();

    const attempts = (row?.attempts ?? 0) + 1;
    const nextStatus = attempts >= MAX_OP_ATTEMPTS ? 'skipped' : 'pending';

    await this.table(tenant)
      .where({ op_id: opId })
      .update({
        status: nextStatus,
        attempts,
        last_error: error,
        processed_at: nextStatus === 'skipped' ? this.knex.fn.now() : null
      });

    return nextStatus;
  }

  async markFailedTerminal(tenant: string, opId: string, error: string): Promise<'failed'> {
    const row = await this.table<AccountingSyncOperation>(tenant)
      .where({ op_id: opId })
      .first();

    await this.table(tenant)
      .where({ op_id: opId })
      .update({
        status: 'failed',
        attempts: (row?.attempts ?? 0) + 1,
        last_error: error,
        processed_at: this.knex.fn.now()
      });

    return 'failed';
  }

  /**
   * Mark pending ops done because the work happened elsewhere (e.g. a manual
   * export batch covered queued invoice exports). Realm-exact: work delivered
   * into one target realm only satisfies ops queued against that same realm —
   * a manual batch for company A must not retire a pending export for company
   * B. A null realm satisfies only legacy null-realm ops. Returns affected count.
   */
  async satisfyPending(
    tenant: string,
    adapterType: string,
    operation: SyncOperationType,
    algaEntityIds: string[],
    targetRealm: string | null
  ): Promise<number> {
    if (algaEntityIds.length === 0) {
      return 0;
    }

    const query = this.table(tenant)
      .where({ adapter_type: adapterType, operation, status: 'pending' })
      .whereIn('alga_entity_id', algaEntityIds);

    if (targetRealm === null) {
      query.whereNull('target_realm');
    } else {
      query.andWhere({ target_realm: targetRealm });
    }

    return query.update({ status: 'done', processed_at: this.knex.fn.now(), last_error: null });
  }

  async countByStatus(tenant: string, adapterType: string): Promise<Record<string, number>> {
    const rows = await this.table(tenant)
      .where({ adapter_type: adapterType })
      .select('status')
      .count<{ status: string; count: string }[]>('* as count')
      .groupBy('status');

    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }
}
