/**
 * One poll cycle for one tenant's Huntress integration: cursor-walk new
 * incident activity, process each incident ascending, advance the cursor
 * only past successes, and record sync status on the integration row.
 */

import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { createTenantKnex } from '@/lib/db';
import { runRmmSyncWithTransport } from '../../rmm/sync/syncOrchestration';
import { createHuntressClient } from '../huntressClient';
import { isRoutingConfigComplete, parseHuntressSettings } from '../settings';
import { collectIncidentsSince } from './cursorWalk';
import { processIncident } from './incidentProcessor';

export interface HuntressPollInput {
  tenantId: string;
  integrationId: string;
  trigger?: 'scheduled' | 'manual';
}

export interface HuntressPollResult {
  success: boolean;
  skipped?: 'integration_not_found' | 'routing_config_incomplete' | 'missing_credentials';
  processed: number;
  failed: number;
  cursor?: string | null;
  error?: string;
}

export async function pollHuntressIncidents(
  input: HuntressPollInput
): Promise<HuntressPollResult> {
  const { tenantId, integrationId } = input;
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenantId);

  const row = await db.table('rmm_integrations')
    .where({ integration_id: integrationId, provider: 'huntress' })
    .first();
  if (!row || !row.is_active) {
    return { success: false, skipped: 'integration_not_found', processed: 0, failed: 0 };
  }

  const settings = parseHuntressSettings(row.settings);
  if (!isRoutingConfigComplete(settings)) {
    // Not an error — setup is simply unfinished. The settings UI nags instead.
    return { success: true, skipped: 'routing_config_incomplete', processed: 0, failed: 0 };
  }

  const client = await createHuntressClient(tenantId);
  if (!client) {
    await db.table('rmm_integrations')
      .where({ integration_id: integrationId })
      .update({
        sync_status: 'error',
        sync_error: 'Missing Huntress API credentials',
        updated_at: knex.fn.now(),
      });
    return {
      success: false,
      skipped: 'missing_credentials',
      processed: 0,
      failed: 0,
      error: 'Missing Huntress API credentials',
    };
  }

  await db.table('rmm_integrations')
    .where({ integration_id: integrationId })
    .update({ sync_status: 'syncing', updated_at: knex.fn.now() });

  let incidents;
  try {
    incidents = await collectIncidentsSince(
      async (pageToken) => {
        const page = await client.listIncidentReportsPage({ page_token: pageToken });
        return {
          incidents: page.incident_reports ?? [],
          nextPageToken: page.pagination?.next_page_token ?? undefined,
        };
      },
      { cursorIso: settings.incidentCursor ?? null, backfillDays: settings.backfillDays }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.table('rmm_integrations')
      .where({ integration_id: integrationId })
      .update({ sync_status: 'error', sync_error: message, updated_at: knex.fn.now() });
    logger.error('[Huntress] Incident list failed', { tenantId, error: message });
    return { success: false, processed: 0, failed: 0, error: message };
  }

  const deps = {
    getAgent: (id: number) => client.getAgent(id),
    getOrganization: (id: number) => client.getOrganization(id),
  };

  let processed = 0;
  let cursor = settings.incidentCursor ?? null;
  let failure: string | undefined;

  for (const incident of incidents) {
    const result = await processIncident(
      knex,
      tenantId,
      { integration_id: integrationId, settings },
      incident,
      deps
    );
    if (!result.ok) {
      failure = result.error ?? 'Incident processing failed';
      break;
    }
    processed += 1;
    if (!cursor || Date.parse(incident.updated_at) > Date.parse(cursor)) {
      cursor = incident.updated_at;
    }
  }

  // Re-read settings before writing the cursor so config edits made while
  // the poll ran are not clobbered.
  const latest = await db.table('rmm_integrations')
    .where({ integration_id: integrationId })
    .first('settings');
  const merged = {
    ...parseHuntressSettings(latest?.settings ?? row.settings),
    incidentCursor: cursor ?? undefined,
  };

  await db.table('rmm_integrations')
    .where({ integration_id: integrationId })
    .update({
      settings: JSON.stringify(merged),
      sync_status: failure ? 'error' : 'completed',
      sync_error: failure ?? null,
      last_incremental_sync_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });

  logger.info('[Huntress] Poll cycle finished', {
    tenantId,
    integrationId,
    trigger: input.trigger ?? 'scheduled',
    collected: incidents.length,
    processed,
    failed: failure ? 1 : 0,
  });

  return { success: !failure, processed, failed: failure ? 1 : 0, cursor, error: failure };
}

/**
 * Transport-wrapped entry point (HUNTRESS_SYNC_TRANSPORT → RMM_SYNC_TRANSPORT
 * → 'direct'). No Temporal workflow exists yet — leave the transport unset or
 * 'direct' until one is added.
 */
export async function runHuntressIncidentPoll(
  input: HuntressPollInput
): Promise<HuntressPollResult> {
  return runRmmSyncWithTransport<HuntressPollInput, HuntressPollResult>({
    context: { provider: 'huntress', operation: 'incident_poll', input },
    directExecutor: async (context) => pollHuntressIncidents(context.input),
  });
}
