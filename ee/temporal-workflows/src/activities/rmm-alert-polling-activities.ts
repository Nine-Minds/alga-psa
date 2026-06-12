/**
 * Activities for the per-integration RMM alert reconciliation and Huntress
 * incident poll schedules. Thin wrappers: the business logic lives in
 * ee/server (reached via the @ee alias) and shared/rmm/alerts, following the
 * ninjaone-token-refresh activity pattern.
 *
 * Schedules reconcile at worker boot, so each run re-checks the integration's
 * current state and no-ops when polling was disabled or the integration
 * disconnected since the last reconciliation.
 */

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin.js';
import { runWithTenant, createTenantKnex } from '@alga-psa/db';
import {
  registerRmmAlertFetcher,
  runRmmAlertReconciliation,
  type ReconciliationResult,
} from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import { tacticalRmmAlertFetcher } from '@alga-psa/integrations/lib/rmm/tacticalrmm/alertFetcher';
import { ninjaOneAlertFetcher } from '@ee/lib/integrations/ninjaone/alerts/reconciliationFetcher';
import { runHuntressIncidentPoll } from '@ee/lib/integrations/huntress/incidents/incidentPoller';

export interface RmmAlertReconciliationActivityInput {
  tenantId: string;
  integrationId: string;
  provider: string;
}

export interface HuntressIncidentPollActivityInput {
  tenantId: string;
  integrationId: string;
}

let fetchersRegistered = false;
function ensureFetchersRegistered(): void {
  if (fetchersRegistered) return;
  registerRmmAlertFetcher('ninjaone', ninjaOneAlertFetcher);
  registerRmmAlertFetcher('tacticalrmm', tacticalRmmAlertFetcher);
  fetchersRegistered = true;
}

async function integrationStillEligible(
  tenantId: string,
  integrationId: string,
  requirePollingEnabled: boolean
): Promise<boolean> {
  const knex = await getAdminConnection();
  const integration = await knex('rmm_integrations')
    .where({ tenant: tenantId, integration_id: integrationId, is_active: true })
    .first('settings');
  if (!integration) return false;
  if (!requirePollingEnabled) return true;
  const settings =
    typeof integration.settings === 'string' ? safeParse(integration.settings) : integration.settings;
  const polling = (settings?.alertPolling ?? {}) as Record<string, unknown>;
  return polling.enabled !== false;
}

export async function runRmmAlertReconciliationActivity(
  input: RmmAlertReconciliationActivityInput
): Promise<ReconciliationResult | { skipped: true; reason: string }> {
  ensureFetchersRegistered();

  if (!(await integrationStillEligible(input.tenantId, input.integrationId, true))) {
    logger.info('[RmmAlertReconciliationActivity] Skipping: integration inactive or polling disabled', input);
    return { skipped: true, reason: 'integration_inactive_or_polling_disabled' };
  }

  return runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const result = await runRmmAlertReconciliation(
      { knex, deps: buildRmmAlertPipelineDeps() },
      { tenantId: input.tenantId, integrationId: input.integrationId, provider: input.provider }
    );
    for (const warning of result.warnings) {
      logger.warn('[RmmAlertReconciliationActivity] warning', { ...input, warning });
    }
    logger.info('[RmmAlertReconciliationActivity] cycle complete', {
      ...input,
      remoteActive: result.remoteActive,
      ingested: result.ingested,
      resetsSynthesized: result.resetsSynthesized,
    });
    return result;
  });
}

export async function runHuntressIncidentPollActivity(
  input: HuntressIncidentPollActivityInput
): Promise<{ skipped?: boolean; reason?: string }> {
  if (!(await integrationStillEligible(input.tenantId, input.integrationId, false))) {
    logger.info('[HuntressIncidentPollActivity] Skipping: integration inactive', input);
    return { skipped: true, reason: 'integration_inactive' };
  }

  await runWithTenant(input.tenantId, async () => {
    await runHuntressIncidentPoll({
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      trigger: 'scheduled',
    });
  });
  return {};
}

function safeParse(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
