import logger from '@alga-psa/core/logger';
import { runWithTenant } from '@alga-psa/db';

import { runDattoRmmDeviceSync } from './deviceSync';
import { DATTO_RMM_PROVIDER } from './shared';
import { provisionClientsForNewDattoSitesIfEnabled } from './siteClientProvisioning';
import { runDattoRmmSiteSync } from './siteSync';

/**
 * Datto RMM's incremental device sync for the rmm-device-sync job.
 *
 * Datto has no server-side delta — device listings take only paging
 * parameters — so "incremental" is the same page walk with the result filtered
 * on lastSeen / lastAuditDate, and unchanged devices only get their liveness
 * refreshed. Fewer ingest writes and audit calls, but the same number of
 * listing reads.
 *
 * Each run first refreshes the site list (one cheap call per 250 sites), so a
 * site added in Datto shows up for mapping, and its device count keeps the
 * listing choice honest, without anyone pressing "Sync sites".
 *
 * Like Tactical RMM this sync ships in packages/integrations rather than under
 * ee/, so it is available in CE as well as EE.
 */
export const dattoRmmDeviceSyncStrategy = {
  async syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
  }): Promise<{ devicesProcessed: number }> {
    // The engine resolves its own connection via createTenantKnex(), which reads
    // the AsyncLocalStorage tenant — a job has none, so establish it here.
    return runWithTenant(input.tenantId, async () => {
      await refreshSitesBeforeDeviceSync(input.tenantId);

      const result = await runDattoRmmDeviceSync(
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
            ? `Datto RMM incremental device sync failed: ${result.error}`
            : `Datto RMM incremental device sync reported failure (${result.items_failed} failed)${detail}`,
        );
      }

      return { devicesProcessed: result.items_processed ?? 0 };
    });
  },
};

/**
 * Site sync, then (when the tenant opted in) clients for the sites it found for
 * the first time. Never fails the device sync: an unrefreshed site list only
 * means mapping waits for the next run.
 */
async function refreshSitesBeforeDeviceSync(tenant: string): Promise<void> {
  try {
    const sites = await runDattoRmmSiteSync({ tenant });
    if (!sites.success) {
      logger.warn('[DattoRmmDeviceSync] site refresh before device sync failed', {
        tenant,
        provider: DATTO_RMM_PROVIDER,
        error: sites.error,
      });
      return;
    }

    const outcome = await provisionClientsForNewDattoSitesIfEnabled({
      tenant,
      newSiteUids: sites.created_site_uids,
    });
    if (outcome) {
      logger.info('[DattoRmmDeviceSync] auto-created clients for new sites', {
        tenant,
        provider: DATTO_RMM_PROVIDER,
        success: outcome.success,
        error: outcome.error,
        created: outcome.created,
        linked: outcome.linked,
        skipped: outcome.skipped,
        failed: outcome.failed,
      });
    }
  } catch (err) {
    logger.warn('[DattoRmmDeviceSync] site refresh before device sync failed', {
      tenant,
      provider: DATTO_RMM_PROVIDER,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
