import { createTenantKnex } from '@alga-psa/db';
import { createLevelIoClient } from '../levelApiClient';
import { runLevelIoFullSync } from './syncEngine';

/**
 * Level.io's incremental device sync for the rmm-device-sync job.
 *
 * Level.io has no server-side delta: /v2/devices accepts only group filters,
 * and `starting_after` is a pagination cursor by item id rather than a time
 * filter. So "incremental" here means the same page walk as a full sync with
 * the result filtered on last_seen_at — fewer ingest writes and less mapping
 * work, but the same number of API reads. Recorded in the plan's scratchpad so
 * nobody later mistakes this for a cheap call.
 */
export const levelIoDeviceSyncStrategy = {
  async syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
  }): Promise<{ devicesProcessed: number }> {
    const { knex } = await createTenantKnex();
    const client = await createLevelIoClient(input.tenantId);

    const result = await runLevelIoFullSync(
      { tenant: input.tenantId, integrationId: input.integrationId },
      { knex, client },
      { syncType: 'incremental', since: input.since },
    );

    // RmmSyncResult reports failure in a field rather than by throwing, and the
    // job advances the delta cursor on any resolved promise. Returning normally
    // here would skip whatever changed in the failed window, permanently.
    if (!result.success) {
      const detail = result.errors?.length ? `: ${result.errors.join('; ')}` : '';
      throw new Error(
        `Level.io incremental device sync reported failure (${result.items_failed} failed)${detail}`,
      );
    }

    return { devicesProcessed: result.items_processed };
  },
};
