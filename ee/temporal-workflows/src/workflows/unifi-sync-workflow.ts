import { proxyActivities, log } from '@temporalio/workflow';

import type { RmmSyncResult } from '@ee/interfaces/rmm.interfaces';

export type UniFiSyncType = 'organizations' | 'full';

export interface UniFiSyncInput {
  tenantId: string;
  integrationId: string;
  syncType: UniFiSyncType;
}

export interface UniFiDeviceSyncInput {
  tenantId: string;
  integrationId: string;
  scopeKey: string;
  deviceId: string;
}

export interface UniFiDeviceSyncResult {
  externalDeviceId: string;
  action: 'created' | 'updated' | 'marked_deleted' | 'skipped' | 'failed';
  assetId?: string;
  error?: string;
}

const activities = proxyActivities<{
  syncUniFiSitesActivity(input: { tenantId: string; integrationId: string }): Promise<RmmSyncResult>;
  syncUniFiDevicesFullActivity(input: { tenantId: string; integrationId: string }): Promise<RmmSyncResult>;
  syncUniFiDeviceActivity(input: UniFiDeviceSyncInput): Promise<UniFiDeviceSyncResult>;
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

export async function unifiSyncWorkflow(input: UniFiSyncInput): Promise<RmmSyncResult> {
  const { tenantId, integrationId, syncType } = input;

  log.info('Starting UniFi sync workflow', { tenantId, integrationId, syncType });

  switch (syncType) {
    case 'organizations':
      return await activities.syncUniFiSitesActivity({ tenantId, integrationId });
    case 'full':
      return await activities.syncUniFiDevicesFullActivity({ tenantId, integrationId });
    default:
      throw new Error(`Unsupported UniFi sync type: ${syncType}`);
  }
}

export async function unifiDeviceSyncWorkflow(input: UniFiDeviceSyncInput): Promise<UniFiDeviceSyncResult> {
  log.info('Starting UniFi device sync workflow', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    deviceId: input.deviceId,
  });

  return await activities.syncUniFiDeviceActivity(input);
}
