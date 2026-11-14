/**
 * UniFi sync transport helpers.
 *
 * UniFi is Temporal-first, like Level.io: unifiTransportOverride() defaults to
 * 'temporal' rather than resolveRmmSyncTransport()'s global 'direct' default.
 * Env precedence: UNIFI_SYNC_TRANSPORT > RMM_SYNC_TRANSPORT > 'temporal'.
 */

import type { RmmSyncTransport } from '../../rmm/sync/syncOrchestration';
import type { RmmSyncResult } from '../../../../interfaces/rmm.interfaces';

export type UniFiWorkflowSyncType = 'organizations' | 'full';

export interface UniFiDeviceSyncOutcome {
  externalDeviceId: string;
  action: 'created' | 'updated' | 'marked_deleted' | 'skipped' | 'failed';
  assetId?: string;
  error?: string;
}

export function unifiTransportOverride(): RmmSyncTransport {
  const specific = process.env.UNIFI_SYNC_TRANSPORT;
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

export async function startUniFiSyncWorkflow(args: {
  tenantId: string;
  integrationId: string;
  syncType: UniFiWorkflowSyncType;
}): Promise<RmmSyncResult> {
  const client = await getTemporalClient();
  const handle = await client.workflow.start('unifiSyncWorkflow', {
    taskQueue: getTaskQueue(),
    workflowId: `unifi:${args.syncType}:${args.tenantId}:${args.integrationId}:${Date.now()}`,
    args: [{ tenantId: args.tenantId, integrationId: args.integrationId, syncType: args.syncType }],
  });
  return await handle.result();
}

export async function startUniFiDeviceSyncWorkflow(args: {
  tenantId: string;
  integrationId: string;
  scopeKey: string;
  deviceId: string;
  waitForResult: boolean;
}): Promise<UniFiDeviceSyncOutcome | null> {
  const client = await getTemporalClient();
  const handle = await client.workflow.start('unifiDeviceSyncWorkflow', {
    taskQueue: getTaskQueue(),
    workflowId: `unifi:device:${args.tenantId}:${args.deviceId}:${Date.now()}`,
    args: [
      { tenantId: args.tenantId, integrationId: args.integrationId, scopeKey: args.scopeKey, deviceId: args.deviceId },
    ],
  });
  if (!args.waitForResult) {
    return null;
  }
  return await handle.result();
}
