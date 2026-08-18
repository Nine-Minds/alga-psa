import { runWithTenant } from '@alga-psa/db';
import { runTaniumDeviceSync } from './deviceSyncEngine';

/**
 * Tanium's incremental device sync for the rmm-device-sync job.
 *
 * As with Level.io and Tactical, the provider offers no server-side delta —
 * listEndpoints() filters by computer group only — so "incremental" is the same
 * page walk filtered on each endpoint's lastSeen. Fewer ingest writes and less
 * criticality enrichment, but the same number of API reads.
 */
export const taniumDeviceSyncStrategy = {
  async syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
  }): Promise<{ devicesProcessed: number }> {
    // The engine resolves its own connection via createTenantKnex(), which reads
    // the AsyncLocalStorage tenant — a job has none, so establish it here.
    return runWithTenant(input.tenantId, async () => {
      const result = await runTaniumDeviceSync(
        { tenant: input.tenantId },
        { syncType: 'incremental', since: input.since },
      );

      // The engine reports failure in a field rather than by throwing, and the
      // job advances the delta cursor on any resolved promise. Returning
      // normally here would skip whatever changed in the failed window,
      // permanently and silently.
      //
      // Note this is stricter than Tactical's: Tanium sets success to
      // errors.length === 0, so a single endpoint that fails every run holds the
      // cursor still and the window is re-read each interval. That is the
      // deliberate trade — a stalled cursor is loud (sync_status 'error', the
      // failure in sync_error, the schedule visibly retrying) where skipped
      // devices are silent. A poison-pill endpoint should be fixed, not skipped.
      if (!result.success) {
        const detail = result.errors?.length ? `: ${result.errors.join('; ')}` : '';
        throw new Error(
          result.error
            ? `Tanium incremental device sync failed: ${result.error}`
            : `Tanium incremental device sync reported failure (${result.items_failed} failed)${detail}`,
        );
      }

      return { devicesProcessed: result.items_processed ?? 0 };
    });
  },
};
