import { heartbeat } from '@temporalio/activity';

import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';

import { createUniFiClient } from '@ee/lib/integrations/unifi/unifiApiClient';
import {
  runUniFiDeviceSync,
  runUniFiFullSync,
  runUniFiScopeSync,
  type UniFiSyncDeps,
} from '@ee/lib/integrations/unifi/sync/syncEngine';
import type { RmmSyncResult } from '@ee/interfaces/rmm.interfaces';

interface UniFiActivityInput {
  tenantId: string;
  integrationId: string;
}

async function buildDeps(tenantId: string, integrationId: string): Promise<UniFiSyncDeps> {
  const knex = await getAdminConnection();
  const row = await tenantDb(knex, tenantId)
    .table('rmm_integrations')
    .where({ integration_id: integrationId })
    .first('settings');
  const settings = typeof row?.settings === 'string' ? JSON.parse(row.settings) : row?.settings ?? {};
  const client = await createUniFiClient(tenantId, settings.connectionMode === 'local' ? 'local' : 'site_manager');
  return { knex, client };
}

async function withHeartbeat<T>(run: () => Promise<T>): Promise<T> {
  const interval = setInterval(() => {
    try {
      heartbeat();
    } catch {
      // heartbeat() throws outside an activity context; ignore.
    }
  }, 30_000);

  try {
    return await run();
  } finally {
    clearInterval(interval);
  }
}

export async function syncUniFiSitesActivity(input: UniFiActivityInput): Promise<RmmSyncResult> {
  logger.info('[UniFi] site discovery activity started', { tenantId: input.tenantId });
  const deps = await buildDeps(input.tenantId, input.integrationId);
  return withHeartbeat(() => runUniFiScopeSync({ tenant: input.tenantId, integrationId: input.integrationId }, deps));
}

export async function syncUniFiDevicesFullActivity(input: UniFiActivityInput): Promise<RmmSyncResult> {
  logger.info('[UniFi] full device sync activity started', { tenantId: input.tenantId });
  const deps = await buildDeps(input.tenantId, input.integrationId);
  return withHeartbeat(() => runUniFiFullSync({ tenant: input.tenantId, integrationId: input.integrationId }, deps));
}

export async function syncUniFiDeviceActivity(input: UniFiActivityInput & { scopeKey: string; deviceId: string }) {
  logger.info('[UniFi] single device sync activity started', { tenantId: input.tenantId, deviceId: input.deviceId });
  const deps = await buildDeps(input.tenantId, input.integrationId);
  return withHeartbeat(() =>
    runUniFiDeviceSync(
      { tenant: input.tenantId, integrationId: input.integrationId, scopeKey: input.scopeKey, deviceId: input.deviceId },
      deps
    )
  );
}
