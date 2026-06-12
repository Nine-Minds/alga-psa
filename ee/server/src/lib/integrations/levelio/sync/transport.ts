/**
 * Level.io sync transport helpers.
 *
 * Level is Temporal-first: unlike resolveRmmSyncTransport()'s global 'direct'
 * default, levelIoTransportOverride() defaults to 'temporal'. Env precedence
 * is preserved: LEVELIO_SYNC_TRANSPORT > RMM_SYNC_TRANSPORT > 'temporal'.
 */

import type { RmmSyncTransport } from '../../rmm/sync/syncOrchestration';
import type { RmmSyncResult } from '../../../../interfaces/rmm.interfaces';

export type LevelIoWorkflowSyncType = 'organizations' | 'full' | 'alerts';

export interface LevelIoDeviceSyncOutcome {
  externalDeviceId: string;
  action: 'created' | 'updated' | 'marked_deleted' | 'skipped' | 'failed';
  assetId?: string;
  error?: string;
}

export function levelIoTransportOverride(): RmmSyncTransport {
  const specific = process.env.LEVELIO_SYNC_TRANSPORT;
  if (specific === 'temporal' || specific === 'direct') {
    return specific;
  }
  const globalSetting = process.env.RMM_SYNC_TRANSPORT;
  if (globalSetting === 'temporal' || globalSetting === 'direct') {
    return globalSetting;
  }
  return 'temporal';
}

async function getTemporalClient() {
  const temporal = await import('@temporalio/client');
  const address = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const connection = await temporal.Connection.connect({ address });
  return new temporal.Client({ connection, namespace });
}

function getTaskQueue(): string {
  return process.env.TEMPORAL_JOB_TASK_QUEUE || 'alga-jobs';
}

export async function startLevelIoSyncWorkflow(args: {
  tenantId: string;
  integrationId: string;
  syncType: LevelIoWorkflowSyncType;
}): Promise<RmmSyncResult> {
  const client = await getTemporalClient();
  const handle = await client.workflow.start('levelIoSyncWorkflow', {
    taskQueue: getTaskQueue(),
    workflowId: `levelio:${args.syncType}:${args.tenantId}:${args.integrationId}:${Date.now()}`,
    args: [{ tenantId: args.tenantId, integrationId: args.integrationId, syncType: args.syncType }],
  });
  return await handle.result();
}

export async function startLevelIoDeviceSyncWorkflow(args: {
  tenantId: string;
  integrationId: string;
  deviceId: string;
  waitForResult: boolean;
}): Promise<LevelIoDeviceSyncOutcome | null> {
  const client = await getTemporalClient();
  const handle = await client.workflow.start('levelIoDeviceSyncWorkflow', {
    taskQueue: getTaskQueue(),
    workflowId: `levelio:device:${args.tenantId}:${args.deviceId}:${Date.now()}`,
    args: [{ tenantId: args.tenantId, integrationId: args.integrationId, deviceId: args.deviceId }],
  });
  if (!args.waitForResult) {
    return null;
  }
  return await handle.result();
}
