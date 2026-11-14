import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { createUniFiClient } from '../unifiApiClient';
import { runUniFiFullSync } from './syncEngine';

/**
 * UniFi's device sync for the rmm-device-sync job.
 *
 * UniFi exposes no "changed since" filter, so this is a FULL sync and `since`
 * is ignored. The full run is also what makes tombstoning safe: it only ever
 * tombstones against a complete per-site listing.
 */
export const uniFiDeviceSyncStrategy = {
  async syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
  }): Promise<{ devicesProcessed: number }> {
    const { knex } = await createTenantKnex();
    const row = await tenantDb(knex, input.tenantId)
      .table('rmm_integrations')
      .where({ integration_id: input.integrationId })
      .first('settings');
    const settings = typeof row?.settings === 'string' ? JSON.parse(row.settings) : row?.settings ?? {};
    const client = await createUniFiClient(input.tenantId, settings.connectionMode === 'local' ? 'local' : 'site_manager');

    const result = await runUniFiFullSync({ tenant: input.tenantId, integrationId: input.integrationId }, { knex, client });

    // RmmSyncResult reports failure in a field rather than by throwing, and the
    // job advances its cursor on any resolved promise; surface failure as a throw.
    if (!result.success) {
      const detail = result.errors?.length ? `: ${result.errors.join('; ')}` : '';
      throw new Error(`UniFi device sync reported failure (${result.items_failed} failed)${detail}`);
    }

    return { devicesProcessed: result.items_processed };
  },
};
