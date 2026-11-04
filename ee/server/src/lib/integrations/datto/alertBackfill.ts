import { createTenantKnex } from '@alga-psa/db';
import { tenantScopedTable } from './db';
import { axiosErrorToMessage } from './errors';
import { publishRmmSyncEvent } from './events';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import { getDattoIntegrationRow } from './buildClient';
import { DattoRmmAuthError, DattoRmmPermissionError } from './dattoApiClient';
// Type-only: deviceSync.ts owns the shared Datto sync result shape.
import type { DattoSyncResult } from './deviceSync';
import { DATTO_RMM_PROVIDER } from './shared';

function errorToMessage(err: unknown): string {
  if (err instanceof DattoRmmAuthError || err instanceof DattoRmmPermissionError) return err.message;
  return axiosErrorToMessage(err, 'Datto RMM');
}

/**
 * Manual "Sync Alerts": one reconciliation cycle (the same one the poller
 * runs), so open Datto alerts flow through the shared pipeline (rules, dedup,
 * windows, ticketing) and poller-ingested alerts that are no longer open in
 * Datto get synthesized resets. Mirrors backfillTacticalRmmAlerts.
 *
 * Counts: processed = open alerts in mapped sites, created = alerts ingested,
 * updated = resets synthesized, failed = warnings (per-alert failures).
 */
export async function runDattoRmmAlertBackfill(args: {
  tenant: string;
  actorUserId?: string;
}): Promise<DattoSyncResult> {
  const { tenant, actorUserId } = args;
  // Used for emitting failure events in the catch block.
  let integrationId: string | undefined;

  try {
    const { knex } = await createTenantKnex();
    const integration = await getDattoIntegrationRow(knex, tenant);

    if (!integration?.integration_id) {
      return {
        success: false,
        items_processed: 0,
        items_created: 0,
        items_updated: 0,
        items_failed: 0,
        error: 'Datto RMM is not configured yet. Save settings first.',
      };
    }

    const integrationIdForEvents = String(integration.integration_id);
    integrationId = integrationIdForEvents;

    await publishRmmSyncEvent({
      provider: DATTO_RMM_PROVIDER,
      eventType: 'RMM_SYNC_STARTED',
      tenantId: tenant,
      actorUserId,
      integrationId: integrationIdForEvents,
      syncType: 'alerts',
    });

    const { runRmmAlertReconciliation } = await import('@alga-psa/shared/rmm/alerts');
    await import('./alertFetcher'); // registers the fetcher

    const result = await runRmmAlertReconciliation(
      { knex, deps: buildRmmAlertPipelineDeps() },
      { tenantId: tenant, integrationId: integrationIdForEvents, provider: DATTO_RMM_PROVIDER }
    );
    if (result.skipped) {
      // The fetcher could not say what is open; nothing was ingested or reset.
      const message = 'Datto RMM is not connected or no sites are mapped.';
      await publishRmmSyncEvent({
        provider: DATTO_RMM_PROVIDER,
        eventType: 'RMM_SYNC_FAILED',
        tenantId: tenant,
        actorUserId,
        integrationId: integrationIdForEvents,
        syncType: 'alerts',
        errorMessage: message,
      });
      return {
        success: false,
        items_processed: 0,
        items_created: 0,
        items_updated: 0,
        items_failed: 0,
        error: message,
      };
    }
    const errors = [...result.warnings];

    await tenantScopedTable(knex, 'rmm_integrations', tenant)
      .where({ provider: DATTO_RMM_PROVIDER })
      .update({ last_sync_at: knex.fn.now(), sync_error: errors.length ? errors.slice(0, 5).join('; ') : null });

    await publishRmmSyncEvent({
      provider: DATTO_RMM_PROVIDER,
      eventType: 'RMM_SYNC_COMPLETED',
      tenantId: tenant,
      actorUserId,
      integrationId: integrationIdForEvents,
      syncType: 'alerts',
      itemsProcessed: result.remoteActive,
      itemsCreated: result.ingested,
      itemsUpdated: result.resetsSynthesized,
      itemsFailed: errors.length,
    });

    return {
      success: true,
      items_processed: result.remoteActive,
      items_created: result.ingested,
      items_updated: result.resetsSynthesized,
      items_failed: errors.length,
      errors: errors.length ? errors : undefined,
    };
  } catch (err) {
    const message = errorToMessage(err);
    if (integrationId) {
      await publishRmmSyncEvent({
        provider: DATTO_RMM_PROVIDER,
        eventType: 'RMM_SYNC_FAILED',
        tenantId: tenant,
        actorUserId,
        integrationId,
        syncType: 'alerts',
        errorMessage: message,
      });
    }
    return {
      success: false,
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_failed: 0,
      error: message,
    };
  }
}
