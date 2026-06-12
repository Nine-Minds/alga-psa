import { proxyActivities, log } from '@temporalio/workflow';

import type { RmmSyncResult } from '@ee/interfaces/rmm.interfaces';

export type LevelIoSyncType = 'organizations' | 'full' | 'alerts';

export interface LevelIoSyncInput {
  tenantId: string;
  integrationId: string;
  syncType: LevelIoSyncType;
}

export interface LevelIoDeviceSyncInput {
  tenantId: string;
  integrationId: string;
  deviceId: string;
}

export interface LevelIoDeviceSyncResult {
  externalDeviceId: string;
  action: 'created' | 'updated' | 'marked_deleted' | 'skipped' | 'failed';
  assetId?: string;
  error?: string;
}

const activities = proxyActivities<{
  syncLevelIoOrganizationsActivity(input: { tenantId: string; integrationId: string }): Promise<RmmSyncResult>;
  syncLevelIoDevicesFullActivity(input: { tenantId: string; integrationId: string }): Promise<RmmSyncResult>;
  backfillLevelIoAlertsActivity(input: { tenantId: string; integrationId: string }): Promise<RmmSyncResult>;
  syncLevelIoDeviceActivity(input: LevelIoDeviceSyncInput): Promise<LevelIoDeviceSyncResult>;
}>({
  startToCloseTimeout: '1h',
  heartbeatTimeout: '2m', // If the worker dies, the activity is retried within 2 minutes
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2.0,
    initialInterval: '5s',
    maximumInterval: '1m',
  },
});

export async function levelIoSyncWorkflow(input: LevelIoSyncInput): Promise<RmmSyncResult> {
  const { tenantId, integrationId, syncType } = input;

  log.info('Starting Level.io sync workflow', { tenantId, integrationId, syncType });

  switch (syncType) {
    case 'organizations':
      return await activities.syncLevelIoOrganizationsActivity({ tenantId, integrationId });
    case 'full':
      return await activities.syncLevelIoDevicesFullActivity({ tenantId, integrationId });
    case 'alerts':
      return await activities.backfillLevelIoAlertsActivity({ tenantId, integrationId });
    default:
      throw new Error(`Unsupported Level.io sync type: ${syncType}`);
  }
}

export async function levelIoDeviceSyncWorkflow(input: LevelIoDeviceSyncInput): Promise<LevelIoDeviceSyncResult> {
  log.info('Starting Level.io device sync workflow', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    deviceId: input.deviceId,
  });

  return await activities.syncLevelIoDeviceActivity(input);
}
