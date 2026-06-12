import { Knex } from 'knex';
import type {
  AccountingSyncCycleRecord,
  AccountingSyncCycleStats,
  SyncCycleStatus
} from './accountingSync.types';

const TABLE = 'accounting_sync_cycles';

export class SyncCycleRepository {
  constructor(private readonly knex: Knex) {}

  /** cursor_after of the most recent succeeded cycle, or null on first run. */
  async getLastSuccessfulCursor(
    tenant: string,
    adapterType: string,
    targetRealm: string
  ): Promise<string | null> {
    const row = await this.knex<AccountingSyncCycleRecord>(TABLE)
      .where({ tenant, adapter_type: adapterType, target_realm: targetRealm, status: 'succeeded' })
      .whereNotNull('cursor_after')
      .orderBy('started_at', 'desc')
      .first();

    return row?.cursor_after ?? null;
  }

  async startCycle(params: {
    tenant: string;
    adapterType: string;
    targetRealm: string;
    cursorBefore: string | null;
  }): Promise<string> {
    const [row] = await this.knex(TABLE)
      .insert({
        tenant: params.tenant,
        adapter_type: params.adapterType,
        target_realm: params.targetRealm,
        status: 'running',
        cursor_before: params.cursorBefore
      })
      .returning('cycle_id');

    return typeof row === 'object' ? row.cycle_id : row;
  }

  async finishCycle(
    tenant: string,
    cycleId: string,
    result: {
      status: SyncCycleStatus;
      cursorAfter?: string | null;
      stats?: AccountingSyncCycleStats;
      error?: string | null;
    }
  ): Promise<void> {
    await this.knex(TABLE)
      .where({ tenant, cycle_id: cycleId })
      .update({
        status: result.status,
        finished_at: this.knex.fn.now(),
        cursor_after: result.cursorAfter ?? null,
        stats: result.stats ?? null,
        error: result.error ?? null
      });
  }

  async getLatestCycle(
    tenant: string,
    adapterType: string,
    targetRealm?: string | null
  ): Promise<AccountingSyncCycleRecord | null> {
    const query = this.knex<AccountingSyncCycleRecord>(TABLE)
      .where({ tenant, adapter_type: adapterType })
      .orderBy('started_at', 'desc');

    if (targetRealm) {
      query.andWhere({ target_realm: targetRealm });
    }

    const row = await query.first();
    return row ?? null;
  }
}
