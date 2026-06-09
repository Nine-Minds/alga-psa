import { heartbeat } from '@temporalio/activity';

import logger from '@alga-psa/core/logger';
import { getAdminConnection } from '@alga-psa/db/admin.js';

import { createLevelIoClient } from '@ee/lib/integrations/levelio/levelApiClient';
import {
  runLevelIoAlertsBackfill,
  runLevelIoDeviceSync,
  runLevelIoFullSync,
  runLevelIoScopeSync,
  type LevelIoSyncDeps,
} from '@ee/lib/integrations/levelio/sync/syncEngine';
import type { RmmSyncResult } from '@ee/interfaces/rmm.interfaces';

interface LevelIoActivityInput {
  tenantId: string;
  integrationId: string;
}

async function buildDeps(tenantId: string): Promise<LevelIoSyncDeps> {
  const [knex, client] = await Promise.all([getAdminConnection(), createLevelIoClient(tenantId)]);
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

export async function syncLevelIoOrganizationsActivity(input: LevelIoActivityInput): Promise<RmmSyncResult> {
  logger.info('[LevelIo] organizations sync activity started', { tenantId: input.tenantId });
  const deps = await buildDeps(input.tenantId);
  return withHeartbeat(() =>
    runLevelIoScopeSync({ tenant: input.tenantId, integrationId: input.integrationId }, deps)
  );
}

export async function syncLevelIoDevicesFullActivity(input: LevelIoActivityInput): Promise<RmmSyncResult> {
  logger.info('[LevelIo] full device sync activity started', { tenantId: input.tenantId });
  const deps = await buildDeps(input.tenantId);
  return withHeartbeat(() =>
    runLevelIoFullSync({ tenant: input.tenantId, integrationId: input.integrationId }, deps)
  );
}

export async function backfillLevelIoAlertsActivity(input: LevelIoActivityInput): Promise<RmmSyncResult> {
  logger.info('[LevelIo] alerts backfill activity started', { tenantId: input.tenantId });
  const deps = await buildDeps(input.tenantId);
  return withHeartbeat(() =>
    runLevelIoAlertsBackfill({ tenant: input.tenantId, integrationId: input.integrationId }, deps)
  );
}

export async function syncLevelIoDeviceActivity(input: LevelIoActivityInput & { deviceId: string }) {
  logger.info('[LevelIo] single device sync activity started', {
    tenantId: input.tenantId,
    deviceId: input.deviceId,
  });
  const deps = await buildDeps(input.tenantId);
  return withHeartbeat(() =>
    runLevelIoDeviceSync(
      { tenant: input.tenantId, integrationId: input.integrationId, deviceId: input.deviceId },
      deps
    )
  );
}
