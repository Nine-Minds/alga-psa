import { runWithTenant } from '@alga-psa/db';
import { runTacticalRmmDeviceSync } from './deviceSync';

/**
 * Tactical RMM's incremental device sync for the rmm-device-sync job.
 *
 * Like Level.io, Tactical has no server-side delta — /beta/v1/agent/ filters by
 * client_id only — so "incremental" is the same page walk with the result
 * filtered on last_seen. Fewer ingest writes and less mapping work, but the same
 * number of API reads.
 *
 * Unlike the other two providers this sync ships in packages/integrations rather
 * than under ee/, so it is available in CE as well as EE.
 */
export const tacticalRmmDeviceSyncStrategy = {
  async syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
  }): Promise<{ devicesProcessed: number }> {
    // The engine resolves its own connection via createTenantKnex(), which reads
    // the AsyncLocalStorage tenant — a job has none, so establish it here.
    return runWithTenant(input.tenantId, async () => {
      const result = await runTacticalRmmDeviceSync(
        { tenant: input.tenantId },
        { syncType: 'incremental', since: input.since },
      );

      // The engine reports failure in a field rather than by throwing, and the
      // job advances the delta cursor on any resolved promise. Returning
      // normally here would skip whatever changed in the failed window,
      // permanently and silently.
      if (!result.success) {
        const detail = result.errors?.length ? `: ${result.errors.join('; ')}` : '';
        throw new Error(
          result.error
            ? `Tactical RMM incremental device sync failed: ${result.error}`
            : `Tactical RMM incremental device sync reported failure (${result.items_failed} failed)${detail}`,
        );
      }

      return { devicesProcessed: result.items_processed ?? 0 };
    });
  },
};
