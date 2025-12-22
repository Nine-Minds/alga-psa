import { proxyActivities, log } from '@temporalio/workflow';

import type { RmmSyncResult } from '@ee/interfaces/rmm.interfaces';
import type { Asset } from '@/interfaces/asset.interfaces';

export interface SyncOptions {
  organizationIds?: number[];
  forceRefresh?: boolean;
  batchSize?: number;
  performedBy?: string;
}

export type NinjaOneSyncType = 'organizations' | 'full' | 'incremental';

export interface NinjaOneSyncInput {
  tenantId: string;
  integrationId: string;
  syncType: NinjaOneSyncType;
  since?: string; // ISO timestamp for incremental sync
  options?: SyncOptions;
}

export interface NinjaOneDeviceSyncInput {
  tenantId: string;
  integrationId: string;
  deviceId: number;
}

const activities = proxyActivities<{
  syncNinjaOneOrganizationsActivity(input: {
    tenantId: string;
    integrationId: string;
    performedBy?: string;
  }): Promise<RmmSyncResult>;
  syncNinjaOneDevicesFullActivity(input: {
    tenantId: string;
    integrationId: string;
    options?: SyncOptions;
  }): Promise<RmmSyncResult>;
  syncNinjaOneDevicesIncrementalActivity(input: {
    tenantId: string;
    integrationId: string;
    since: string;
    options?: SyncOptions;
  }): Promise<RmmSyncResult>;
  syncNinjaOneDeviceActivity(input: {
    tenantId: string;
    integrationId: string;
    deviceId: number;
  }): Promise<Asset>;
}>(
  {
    startToCloseTimeout: '1h',
    retry: {
      maximumAttempts: 2,
      backoffCoefficient: 2.0,
      initialInterval: '5s',
      maximumInterval: '1m',
    },
  }
);

export async function ninjaOneSyncWorkflow(
  input: NinjaOneSyncInput
): Promise<RmmSyncResult> {
  const { tenantId, integrationId, syncType, since, options } = input;

  log.info('Starting NinjaOne sync workflow', {
    tenantId,
    integrationId,
    syncType,
  });

  switch (syncType) {
    case 'organizations':
      return await activities.syncNinjaOneOrganizationsActivity({
        tenantId,
        integrationId,
        performedBy: options?.performedBy,
      });
    case 'full':
      return await activities.syncNinjaOneDevicesFullActivity({
        tenantId,
        integrationId,
        options,
      });
    case 'incremental':
      if (!since) {
        throw new Error('Incremental sync requires a since timestamp');
      }
      return await activities.syncNinjaOneDevicesIncrementalActivity({
        tenantId,
        integrationId,
        since,
        options,
      });
    default:
      throw new Error(`Unsupported NinjaOne sync type: ${syncType}`);
  }
}

export async function ninjaOneDeviceSyncWorkflow(
  input: NinjaOneDeviceSyncInput
): Promise<Asset> {
  log.info('Starting NinjaOne device sync workflow', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    deviceId: input.deviceId,
  });

  return await activities.syncNinjaOneDeviceActivity({
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    deviceId: input.deviceId,
  });
}
