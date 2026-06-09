/**
 * Level.io sync engine — the single source of truth for sync logic.
 * Called by both the direct transport (server actions) and Temporal
 * activities; all I/O dependencies are injected via LevelIoSyncDeps.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { getRedisStreamClient } from '@alga-psa/workflow-streams';
import { ingestNormalizedRmmDeviceSnapshot } from '@alga-psa/shared/rmm/sharedAssetIngestionService';
import type { NormalizedRmmIngestionResult } from '@alga-psa/shared/rmm/contracts';
import type { RmmSyncResult } from '../../../../interfaces/rmm.interfaces';
import type { LevelIoApiClient, LevelIoAlert } from '../levelApiClient';
import {
  buildGroupParentMap,
  buildGroupPath,
  mapLevelIoDeviceToSnapshot,
  mapLevelIoSeverity,
  resolveDeepestMappedGroup,
} from '../mappers/deviceMapper';

const PROVIDER = 'levelio' as const;

type LevelIoSyncEventName = 'RMM_SYNC_STARTED' | 'RMM_SYNC_COMPLETED' | 'RMM_SYNC_FAILED';

export interface LevelIoSyncDeps {
  knex: Knex;
  client: LevelIoApiClient;
  ingest?: typeof ingestNormalizedRmmDeviceSnapshot;
  publishEvent?: (event: Record<string, unknown>) => Promise<void>;
}

export interface LevelIoSyncArgs {
  tenant: string;
  integrationId: string;
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function emitSyncEvent(
  deps: LevelIoSyncDeps,
  args: { eventName: LevelIoSyncEventName; tenant: string; payload: Record<string, unknown> }
): Promise<void> {
  const publish =
    deps.publishEvent ??
    (async (event: Record<string, unknown>) => {
      await getRedisStreamClient().publishEvent(event as never);
    });

  try {
    await publish({
      event_id: randomUUID(),
      event_name: args.eventName,
      event_type: args.eventName,
      tenant: args.tenant,
      timestamp: new Date().toISOString(),
      payload: args.payload,
    });
  } catch {
    // Event emission is best-effort.
  }
}

async function setSyncStatus(knex: Knex, tenant: string, patch: Record<string, unknown>): Promise<void> {
  await knex('rmm_integrations')
    .where({ tenant, provider: PROVIDER })
    .update({ ...patch, updated_at: knex.fn.now() });
}

export async function runLevelIoScopeSync(args: LevelIoSyncArgs, deps: LevelIoSyncDeps): Promise<RmmSyncResult> {
  const startedAt = new Date().toISOString();
  await emitSyncEvent(deps, {
    eventName: 'RMM_SYNC_STARTED',
    tenant: args.tenant,
    payload: { integration_id: args.integrationId, provider: PROVIDER, sync_type: 'organizations', started_at: startedAt },
  });

  try {
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'syncing', sync_error: null });

    const groups = await deps.client.listGroups();
    const groupsById = new Map(groups.map((group) => [group.id, group]));

    const existing = await deps.knex('rmm_organization_mappings')
      .where({ tenant: args.tenant, integration_id: args.integrationId })
      .select(['mapping_id', 'external_organization_id']);
    const byExternalId = new Map(existing.map((row: any) => [String(row.external_organization_id), row]));

    let created = 0;
    let updated = 0;
    for (const group of groups) {
      const metadata = {
        kind: 'group',
        parentId: group.parent_id ?? null,
        path: buildGroupPath(group.id, groupsById),
      };
      const prior = byExternalId.get(group.id);
      if (prior) {
        await deps.knex('rmm_organization_mappings')
          .where({ tenant: args.tenant, mapping_id: prior.mapping_id })
          .update({
            external_organization_name: group.name,
            metadata,
            last_synced_at: deps.knex.fn.now(),
            updated_at: deps.knex.fn.now(),
          });
        updated += 1;
      } else {
        await deps.knex('rmm_organization_mappings').insert({
          tenant: args.tenant,
          integration_id: args.integrationId,
          external_organization_id: group.id,
          external_organization_name: group.name,
          auto_sync_assets: true,
          auto_create_tickets: false,
          metadata,
          last_synced_at: deps.knex.fn.now(),
          created_at: deps.knex.fn.now(),
          updated_at: deps.knex.fn.now(),
        });
        created += 1;
      }
    }

    await setSyncStatus(deps.knex, args.tenant, {
      sync_status: 'completed',
      last_sync_at: deps.knex.fn.now(),
      sync_error: null,
    });

    const completedAt = new Date().toISOString();
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_COMPLETED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'organizations',
        items_processed: groups.length,
        items_created: created,
        items_updated: updated,
        items_failed: 0,
        completed_at: completedAt,
      },
    });

    return {
      success: true,
      provider: PROVIDER,
      sync_type: 'organizations',
      started_at: startedAt,
      completed_at: completedAt,
      items_processed: groups.length,
      items_created: created,
      items_updated: updated,
      items_failed: 0,
      errors: [],
    };
  } catch (error) {
    const message = sanitizeError(error);
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'error', sync_error: message }).catch(() => undefined);
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_FAILED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'organizations',
        error: message,
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}

export async function runLevelIoFullSync(args: LevelIoSyncArgs, deps: LevelIoSyncDeps): Promise<RmmSyncResult> {
  const startedAt = new Date().toISOString();
  const ingest = deps.ingest ?? ingestNormalizedRmmDeviceSnapshot;

  await emitSyncEvent(deps, {
    eventName: 'RMM_SYNC_STARTED',
    tenant: args.tenant,
    payload: { integration_id: args.integrationId, provider: PROVIDER, sync_type: 'full', started_at: startedAt },
  });

  try {
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'syncing', sync_error: null });

    const mappings = await deps.knex('rmm_organization_mappings')
      .where({ tenant: args.tenant, integration_id: args.integrationId })
      .whereNotNull('client_id')
      .andWhere('auto_sync_assets', true)
      .select(['external_organization_id', 'client_id']);

    const clientIdByGroupId = new Map<string, string>(
      mappings.map((row: any) => [String(row.external_organization_id), String(row.client_id)])
    );
    const mappedGroupIds = new Set(clientIdByGroupId.keys());

    const [groups, devices, availableUpdates] = await Promise.all([
      deps.client.listGroups(),
      deps.client.listDevices(),
      deps.client.listUpdates({ status: 'available' }),
    ]);

    const parentByGroupId = buildGroupParentMap(groups);
    const pendingOsPatchesByDeviceId = new Map<string, number>();
    for (const update of availableUpdates) {
      pendingOsPatchesByDeviceId.set(update.device_id, (pendingOsPatchesByDeviceId.get(update.device_id) ?? 0) + 1);
    }

    let processed = 0;
    let created = 0;
    let updated = 0;
    let skippedNoMapping = 0;
    const errors: string[] = [];

    for (const device of devices) {
      const scopeGroupId = resolveDeepestMappedGroup(device.group_id ?? null, parentByGroupId, mappedGroupIds);
      if (!scopeGroupId) {
        skippedNoMapping += 1;
        continue;
      }

      const snapshot = mapLevelIoDeviceToSnapshot({
        integrationId: args.integrationId,
        device,
        scopeId: scopeGroupId,
        pendingOsPatches: pendingOsPatchesByDeviceId.get(device.id) ?? 0,
      });

      try {
        const outcome = await ingest({
          tenant: args.tenant,
          snapshot,
          resolvedClientId: clientIdByGroupId.get(scopeGroupId) ?? null,
          knex: deps.knex,
        });
        processed += 1;
        if (outcome.action === 'created') created += 1;
        if (outcome.action === 'updated') updated += 1;
        if (outcome.action === 'failed' && outcome.error) {
          errors.push(`${device.id}: ${outcome.error}`);
        }
      } catch (error) {
        processed += 1;
        errors.push(`${device.id}: ${sanitizeError(error)}`);
      }
    }

    await setSyncStatus(deps.knex, args.tenant, {
      sync_status: errors.length ? 'error' : 'completed',
      last_sync_at: deps.knex.fn.now(),
      last_full_sync_at: deps.knex.fn.now(),
      sync_error: errors.length ? errors.slice(0, 10).join('; ') : null,
    });

    const completedAt = new Date().toISOString();
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_COMPLETED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'full',
        items_processed: processed,
        items_created: created,
        items_updated: updated,
        items_failed: errors.length,
        skipped_no_mapping: skippedNoMapping,
        completed_at: completedAt,
      },
    });

    return {
      success: errors.length === 0,
      provider: PROVIDER,
      sync_type: 'full',
      started_at: startedAt,
      completed_at: completedAt,
      items_processed: processed,
      items_created: created,
      items_updated: updated,
      items_failed: errors.length,
      errors,
    };
  } catch (error) {
    const message = sanitizeError(error);
    await setSyncStatus(deps.knex, args.tenant, { sync_status: 'error', sync_error: message }).catch(() => undefined);
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_FAILED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'full',
        error: message,
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}

export async function runLevelIoDeviceSync(
  args: LevelIoSyncArgs & { deviceId: string },
  deps: LevelIoSyncDeps
): Promise<NormalizedRmmIngestionResult> {
  const ingest = deps.ingest ?? ingestNormalizedRmmDeviceSnapshot;

  const [device, groups, mappings, availableUpdates] = await Promise.all([
    deps.client.getDevice(args.deviceId),
    deps.client.listGroups(),
    deps.knex('rmm_organization_mappings')
      .where({ tenant: args.tenant, integration_id: args.integrationId })
      .whereNotNull('client_id')
      .andWhere('auto_sync_assets', true)
      .select(['external_organization_id', 'client_id']),
    deps.client.listUpdates({ deviceId: args.deviceId, status: 'available' }),
  ]);

  const clientIdByGroupId = new Map<string, string>(
    mappings.map((row: any) => [String(row.external_organization_id), String(row.client_id)])
  );
  const scopeGroupId = resolveDeepestMappedGroup(
    device.group_id ?? null,
    buildGroupParentMap(groups),
    new Set(clientIdByGroupId.keys())
  );

  if (!scopeGroupId) {
    return {
      externalDeviceId: args.deviceId,
      action: 'skipped',
      error: 'Device has no mapped Level group ancestor',
    };
  }

  const snapshot = mapLevelIoDeviceToSnapshot({
    integrationId: args.integrationId,
    device,
    scopeId: scopeGroupId,
    pendingOsPatches: availableUpdates.length,
  });

  return ingest({
    tenant: args.tenant,
    snapshot,
    resolvedClientId: clientIdByGroupId.get(scopeGroupId) ?? null,
    knex: deps.knex,
  });
}

export async function runLevelIoAlertsBackfill(args: LevelIoSyncArgs, deps: LevelIoSyncDeps): Promise<RmmSyncResult> {
  const startedAt = new Date().toISOString();
  await emitSyncEvent(deps, {
    eventName: 'RMM_SYNC_STARTED',
    tenant: args.tenant,
    payload: { integration_id: args.integrationId, provider: PROVIDER, sync_type: 'alerts', started_at: startedAt },
  });

  try {
    const [active, resolved] = await Promise.all([
      deps.client.listAlerts({ status: 'active' }),
      deps.client.listAlerts({ status: 'resolved' }),
    ]);
    const alerts: LevelIoAlert[] = [...active, ...resolved];

    const deviceIds = Array.from(new Set(alerts.map((alert) => alert.device_id)));
    const mappingRows = deviceIds.length
      ? await deps.knex('tenant_external_entity_mappings')
          .where({ tenant: args.tenant, integration_type: PROVIDER, alga_entity_type: 'asset' })
          .whereIn('external_entity_id', deviceIds)
          .select(['external_entity_id', 'alga_entity_id'])
      : [];
    const assetIdByDeviceId = new Map(
      mappingRows.map((row: any) => [String(row.external_entity_id), String(row.alga_entity_id)])
    );

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const alert of alerts) {
      const row = {
        tenant: args.tenant,
        integration_id: args.integrationId,
        external_alert_id: alert.id,
        external_device_id: alert.device_id,
        asset_id: assetIdByDeviceId.get(alert.device_id) ?? null,
        severity: mapLevelIoSeverity(alert.severity),
        priority: null,
        activity_type: 'levelio_alert',
        status: alert.is_resolved ? 'resolved' : 'active',
        message: alert.payload
          ? `${alert.name}: ${alert.description} (${alert.payload})`
          : `${alert.name}: ${alert.description}`,
        source_data: JSON.stringify(alert),
        triggered_at: alert.started_at,
        resolved_at: alert.resolved_at ?? null,
        updated_at: deps.knex.fn.now(),
      };

      try {
        const existing = await deps.knex('rmm_alerts')
          .where({ tenant: args.tenant, integration_id: args.integrationId, external_alert_id: alert.id })
          .first(['alert_id']);
        if (existing?.alert_id) {
          await deps.knex('rmm_alerts').where({ tenant: args.tenant, alert_id: existing.alert_id }).update(row);
          updated += 1;
        } else {
          await deps.knex('rmm_alerts').insert({ ...row, created_at: deps.knex.fn.now() });
          created += 1;
        }
      } catch (error) {
        errors.push(`${alert.id}: ${sanitizeError(error)}`);
      }
    }

    await setSyncStatus(deps.knex, args.tenant, { last_sync_at: deps.knex.fn.now() });

    const completedAt = new Date().toISOString();
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_COMPLETED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'alerts',
        items_processed: alerts.length,
        items_created: created,
        items_updated: updated,
        items_failed: errors.length,
        completed_at: completedAt,
      },
    });

    return {
      success: errors.length === 0,
      provider: PROVIDER,
      sync_type: 'alerts',
      started_at: startedAt,
      completed_at: completedAt,
      items_processed: alerts.length,
      items_created: created,
      items_updated: updated,
      items_failed: errors.length,
      errors,
    };
  } catch (error) {
    const message = sanitizeError(error);
    await emitSyncEvent(deps, {
      eventName: 'RMM_SYNC_FAILED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: PROVIDER,
        sync_type: 'alerts',
        error: message,
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}
