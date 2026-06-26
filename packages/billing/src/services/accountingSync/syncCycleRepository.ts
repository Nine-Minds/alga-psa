import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type {
  AccountingSyncCycleRecord,
  AccountingSyncCycleStats,
  SyncCycleStatus
} from './accountingSync.types';

const TABLE = 'accounting_sync_cycles';

type CycleIdProjection = Pick<AccountingSyncCycleRecord, 'cycle_id'>;

export class SyncCycleRepository {
  constructor(private readonly knex: Knex) {}

  private table<Row extends object = Record<string, unknown>>(tenant: string) {
    return tenantDb(this.knex, tenant).table<Row>(TABLE);
  }

  /** cursor_after of the most recent succeeded cycle, or null on first run. */
  async getLastSuccessfulCursor(
    tenant: string,
    adapterType: string,
    targetRealm: string
  ): Promise<string | null> {
    const row = await this.table<AccountingSyncCycleRecord>(tenant)
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
    const [row] = (await this.table(params.tenant)
      .insert({
        tenant: params.tenant,
        adapter_type: params.adapterType,
        target_realm: params.targetRealm,
        status: 'running',
        cursor_before: params.cursorBefore
      })
      .returning('cycle_id')) as Array<CycleIdProjection | string>;

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
    await this.table(tenant)
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
    const query = this.table<AccountingSyncCycleRecord>(tenant)
      .where({ tenant, adapter_type: adapterType })
      .orderBy('started_at', 'desc');

    if (targetRealm) {
      query.andWhere({ target_realm: targetRealm });
    }

    const row = await query.first();
    return row ?? null;
  }
}
