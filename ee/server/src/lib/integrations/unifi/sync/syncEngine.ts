/**
 * UniFi sync engine — single source of truth for sync logic, called by both the
 * direct transport (server actions) and Temporal activities. All I/O
 * dependencies are injected via UniFiSyncDeps.
 */

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getRedisStreamClient } from '@alga-psa/workflow-streams';
import { ingestNormalizedRmmDeviceSnapshot } from '@alga-psa/shared/rmm/sharedAssetIngestionService';
import type { NormalizedRmmIngestionResult } from '@alga-psa/shared/rmm/contracts';
import { upsertAssetFact } from '@alga-psa/assets/lib/assetFactsService';
import type { RmmSyncResult } from '../../../../interfaces/rmm.interfaces';
import { UniFiApiError, type UniFiApiClient, type UniFiDevice } from '../unifiApiClient';
import { mapUniFiDeviceToSnapshot, normalizeMac, resolveExternalDeviceId } from '../mappers/deviceMapper';

export const UNIFI_PROVIDER = 'unifi' as const;

type UniFiSyncEventName = 'RMM_SYNC_STARTED' | 'RMM_SYNC_COMPLETED' | 'RMM_SYNC_FAILED';

export interface UniFiSyncDeps {
  knex: Knex;
  client: UniFiApiClient;
  ingest?: typeof ingestNormalizedRmmDeviceSnapshot;
  upsertFact?: typeof upsertAssetFact;
  publishEvent?: (event: Record<string, unknown>) => Promise<void>;
}

export interface UniFiSyncArgs {
  tenant: string;
  integrationId: string;
}

/** Scope key stored in rmm_organization_mappings.external_organization_id. */
export function buildUniFiScopeKey(hostId: string, siteId: string): string {
  return `${hostId}:${siteId}`;
}

export function parseUniFiScopeKey(scopeKey: string): { hostId: string; siteId: string } | null {
  const index = scopeKey.indexOf(':');
  if (index <= 0 || index === scopeKey.length - 1) return null;
  return { hostId: scopeKey.slice(0, index), siteId: scopeKey.slice(index + 1) };
}

function sanitizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function emitUniFiSyncEvent(
  deps: Pick<UniFiSyncDeps, 'publishEvent'>,
  args: { eventName: UniFiSyncEventName; tenant: string; payload: Record<string, unknown> }
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

export async function setUniFiSyncStatus(knex: Knex, tenant: string, patch: Record<string, unknown>): Promise<void> {
  await tenantDb(knex, tenant)
    .table('rmm_integrations')
    .where({ provider: UNIFI_PROVIDER })
    .update({ ...patch, updated_at: knex.fn.now() });
}

/**
 * Discovers UniFi sites and upserts one mapping row per `{hostId}:{siteId}`.
 * Existing client mappings are never touched. A console whose site listing
 * failed is reported in errors[] (warning) without aborting the others; if
 * every console failed the sync throws.
 */
export async function runUniFiScopeSync(args: UniFiSyncArgs, deps: UniFiSyncDeps): Promise<RmmSyncResult> {
  const startedAt = new Date().toISOString();
  await emitUniFiSyncEvent(deps, {
    eventName: 'RMM_SYNC_STARTED',
    tenant: args.tenant,
    payload: { integration_id: args.integrationId, provider: UNIFI_PROVIDER, sync_type: 'organizations', started_at: startedAt },
  });

  try {
    await setUniFiSyncStatus(deps.knex, args.tenant, { sync_status: 'syncing', sync_error: null });
    const db = tenantDb(deps.knex, args.tenant);

    const { sites, failures } = await deps.client.listSites();
    if (failures.length > 0 && sites.length === 0) {
      throw new Error(`Unable to list UniFi sites: ${failures.map((f) => `${f.hostName}: ${f.message}`).join('; ')}`);
    }

    const existing = await db
      .table('rmm_organization_mappings')
      .where({ integration_id: args.integrationId })
      .select(['mapping_id', 'external_organization_id']);
    const byScope = new Map(existing.map((row: any) => [String(row.external_organization_id), row]));

    let created = 0;
    let updated = 0;
    for (const site of sites) {
      const scopeKey = buildUniFiScopeKey(site.hostId, site.siteId);
      const metadata = { kind: 'site', hostId: site.hostId, hostName: site.hostName, siteId: site.siteId };
      const label = site.hostName && site.hostName !== site.name ? `${site.hostName} / ${site.name}` : site.name;
      const prior = byScope.get(scopeKey);
      if (prior) {
        await db
          .table('rmm_organization_mappings')
          .where({ mapping_id: prior.mapping_id })
          .update({
            external_organization_name: label,
            metadata,
            last_synced_at: deps.knex.fn.now(),
            updated_at: deps.knex.fn.now(),
          });
        updated += 1;
      } else {
        await db.table('rmm_organization_mappings').insert({
          tenant: args.tenant,
          integration_id: args.integrationId,
          external_organization_id: scopeKey,
          external_organization_name: label,
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

    const warnings = failures.map((f) => `Console "${f.hostName}" could not be listed: ${f.message}`);
    await setUniFiSyncStatus(deps.knex, args.tenant, {
      sync_status: 'completed',
      last_sync_at: deps.knex.fn.now(),
      sync_error: warnings.length ? warnings.join('; ').slice(0, 1000) : null,
    });

    const completedAt = new Date().toISOString();
    await emitUniFiSyncEvent(deps, {
      eventName: 'RMM_SYNC_COMPLETED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: UNIFI_PROVIDER,
        sync_type: 'organizations',
        items_processed: sites.length,
        items_created: created,
        items_updated: updated,
        items_failed: failures.length,
        completed_at: completedAt,
      },
    });

    return {
      success: true,
      provider: UNIFI_PROVIDER,
      sync_type: 'organizations',
      started_at: startedAt,
      completed_at: completedAt,
      items_processed: sites.length,
      items_created: created,
      items_updated: updated,
      items_failed: failures.length,
      errors: warnings,
    };
  } catch (error) {
    const message = sanitizeError(error);
    await setUniFiSyncStatus(deps.knex, args.tenant, { sync_status: 'error', sync_error: message }).catch(() => undefined);
    await emitUniFiSyncEvent(deps, {
      eventName: 'RMM_SYNC_FAILED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: UNIFI_PROVIDER,
        sync_type: 'organizations',
        error: message,
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}

/** Per-device detail fetches (for uplink) run with bounded parallelism. */
const DETAIL_CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface MappedSite {
  scopeKey: string;
  hostId: string;
  siteId: string;
  siteName: string | null;
  clientId: string;
}

async function loadMappedSites(deps: UniFiSyncDeps, tenant: string, integrationId: string): Promise<MappedSite[]> {
  const rows = await tenantDb(deps.knex, tenant)
    .table('rmm_organization_mappings')
    .where({ integration_id: integrationId })
    .whereNotNull('client_id')
    .andWhere('auto_sync_assets', true)
    .select(['external_organization_id', 'external_organization_name', 'client_id']);

  const sites: MappedSite[] = [];
  for (const row of rows as any[]) {
    const parsed = parseUniFiScopeKey(String(row.external_organization_id));
    if (!parsed) continue;
    sites.push({
      scopeKey: String(row.external_organization_id),
      ...parsed,
      siteName: row.external_organization_name ?? null,
      clientId: String(row.client_id),
    });
  }
  return sites;
}

/**
 * The Integration API list omits the uplink; the per-device detail carries it.
 * A failed detail fetch only costs that device its uplink fact, never the sync.
 */
async function enrichWithDetail(
  client: UniFiApiClient,
  site: Pick<MappedSite, 'hostId' | 'siteId'>,
  devices: UniFiDevice[]
): Promise<UniFiDevice[]> {
  return mapWithConcurrency(devices, DETAIL_CONCURRENCY, async (device) => {
    if (!device.id) return device;
    try {
      const detail = await client.getDevice(site, device.id);
      return { ...device, uplinkDeviceId: detail.uplinkDeviceId ?? device.uplinkDeviceId };
    } catch (error) {
      if (error instanceof UniFiApiError && error.kind === 'auth') throw error;
      return device;
    }
  });
}

async function writeDeviceFacts(
  deps: UniFiSyncDeps,
  args: { tenant: string; integrationId: string; assetId: string; device: UniFiDevice; uplinkName: string | null }
): Promise<void> {
  const upsert = deps.upsertFact ?? upsertAssetFact;
  const base = {
    tenant: args.tenant,
    assetId: args.assetId,
    sourceType: 'integration' as const,
    provider: UNIFI_PROVIDER,
    integrationId: args.integrationId,
    namespace: 'unifi',
    source: 'unifi.network.integration.devices',
    sourceUpdatedAt: null,
    lastSyncedAt: new Date(),
  };
  const mac = normalizeMac(args.device.macAddress);
  await upsert(deps.knex, { ...base, factKey: 'mac_address', label: 'MAC Address', valueText: mac, isAvailable: Boolean(mac) });
  await upsert(deps.knex, {
    ...base,
    factKey: 'model',
    label: 'UniFi Model',
    valueText: args.device.model,
    isAvailable: Boolean(args.device.model),
  });
  await upsert(deps.knex, {
    ...base,
    factKey: 'uplink',
    label: 'Uplink Device',
    valueText: args.uplinkName ?? args.device.uplinkDeviceId,
    valueJson: { uplinkDeviceId: args.device.uplinkDeviceId },
    isAvailable: Boolean(args.device.uplinkDeviceId),
  });
}

/**
 * Marks assets tombstoned when their device is gone from a site's COMPLETE
 * listing. Only call this with the ids from a listing that finished without
 * error; the caller owns that guarantee.
 */
async function tombstoneMissingDevices(
  deps: UniFiSyncDeps,
  args: { tenant: string; integrationId: string; scopeKey: string; seenIds: Set<string> }
): Promise<number> {
  const ingest = deps.ingest ?? ingestNormalizedRmmDeviceSnapshot;
  const rows = await tenantDb(deps.knex, args.tenant)
    .table('tenant_external_entity_mappings')
    .where({ integration_type: UNIFI_PROVIDER, alga_entity_type: 'asset', external_realm_id: args.scopeKey })
    .select(['external_entity_id', 'metadata']);

  let tombstoned = 0;
  for (const row of rows as any[]) {
    const externalId = String(row.external_entity_id);
    if (args.seenIds.has(externalId)) continue;
    const metadata = typeof row.metadata === 'string' ? safeJson(row.metadata) : row.metadata;
    if (metadata?.deleted === true) continue;
    const outcome = await ingest({
      tenant: args.tenant,
      knex: deps.knex,
      snapshot: {
        provider: UNIFI_PROVIDER,
        integrationId: args.integrationId,
        externalDeviceId: externalId,
        externalScopeId: args.scopeKey,
        lifecycleState: 'tombstoned',
        assetType: 'network_device',
        displayName: externalId,
      },
    });
    if (outcome.action === 'marked_deleted') tombstoned += 1;
  }
  return tombstoned;
}

function safeJson(value: string): Record<string, any> | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Full device sync across every mapped site. UniFi has no delta endpoint, so
 * the scheduled "incremental" strategy calls this too and ignores `since`.
 *
 * Fail-closed: a site whose listing throws is reported in errors[] and is NOT
 * tombstoned (a partial or failed list must never look like "device removed").
 * Auth failures abort the whole run.
 */
export async function runUniFiFullSync(args: UniFiSyncArgs, deps: UniFiSyncDeps): Promise<RmmSyncResult> {
  const startedAt = new Date().toISOString();
  const ingest = deps.ingest ?? ingestNormalizedRmmDeviceSnapshot;
  await emitUniFiSyncEvent(deps, {
    eventName: 'RMM_SYNC_STARTED',
    tenant: args.tenant,
    payload: { integration_id: args.integrationId, provider: UNIFI_PROVIDER, sync_type: 'full', started_at: startedAt },
  });

  try {
    await setUniFiSyncStatus(deps.knex, args.tenant, { sync_status: 'syncing', sync_error: null });
    const sites = await loadMappedSites(deps, args.tenant, args.integrationId);

    let processed = 0;
    let created = 0;
    let updated = 0;
    let tombstoned = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const site of sites) {
      let listed: UniFiDevice[];
      try {
        listed = await deps.client.listDevices(site);
      } catch (error) {
        if (error instanceof UniFiApiError && error.kind === 'auth') throw error;
        errors.push(`Site ${site.siteName ?? site.scopeKey}: device listing failed (${sanitizeError(error)}); no devices were removed`);
        continue;
      }

      const devices = await enrichWithDetail(deps.client, site, listed);
      const nameById = new Map(devices.filter((d) => d.id).map((d) => [d.id as string, d.name ?? d.model ?? d.id]));
      const seenIds = new Set<string>();

      for (const device of devices) {
        const snapshot = mapUniFiDeviceToSnapshot({
          integrationId: args.integrationId,
          device,
          scopeKey: site.scopeKey,
          siteName: site.siteName,
        });
        if (!snapshot) {
          skipped += 1;
          continue;
        }
        seenIds.add(snapshot.externalDeviceId);
        try {
          const outcome = await ingest({
            tenant: args.tenant,
            snapshot,
            resolvedClientId: site.clientId,
            knex: deps.knex,
          });
          processed += 1;
          if (outcome.action === 'created') created += 1;
          if (outcome.action === 'updated') updated += 1;
          if (outcome.action === 'failed' && outcome.error) {
            errors.push(`${snapshot.externalDeviceId}: ${outcome.error}`);
          }
          if (outcome.assetId) {
            await writeDeviceFacts(deps, {
              tenant: args.tenant,
              integrationId: args.integrationId,
              assetId: outcome.assetId,
              device,
              uplinkName: device.uplinkDeviceId ? nameById.get(device.uplinkDeviceId) ?? null : null,
            });
          }
        } catch (error) {
          processed += 1;
          errors.push(`${snapshot.externalDeviceId}: ${sanitizeError(error)}`);
        }
      }

      try {
        tombstoned += await tombstoneMissingDevices(deps, {
          tenant: args.tenant,
          integrationId: args.integrationId,
          scopeKey: site.scopeKey,
          seenIds,
        });
      } catch (error) {
        errors.push(`Site ${site.siteName ?? site.scopeKey}: tombstoning failed (${sanitizeError(error)})`);
      }
    }

    await setUniFiSyncStatus(deps.knex, args.tenant, {
      sync_status: errors.length ? 'error' : 'completed',
      last_sync_at: deps.knex.fn.now(),
      // Only clean runs stamp last_full_sync_at: a run that skipped a site must
      // not stand in for a complete sweep.
      ...(errors.length ? {} : { last_full_sync_at: deps.knex.fn.now() }),
      sync_error: errors.length ? errors.slice(0, 10).join('; ').slice(0, 1000) : null,
    });

    const completedAt = new Date().toISOString();
    await emitUniFiSyncEvent(deps, {
      eventName: 'RMM_SYNC_COMPLETED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: UNIFI_PROVIDER,
        sync_type: 'full',
        items_processed: processed,
        items_created: created,
        items_updated: updated,
        items_failed: errors.length,
        items_tombstoned: tombstoned,
        skipped_unsupported: skipped,
        completed_at: completedAt,
      },
    });

    return {
      success: errors.length === 0,
      provider: UNIFI_PROVIDER,
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
    await setUniFiSyncStatus(deps.knex, args.tenant, { sync_status: 'error', sync_error: message }).catch(() => undefined);
    await emitUniFiSyncEvent(deps, {
      eventName: 'RMM_SYNC_FAILED',
      tenant: args.tenant,
      payload: {
        integration_id: args.integrationId,
        provider: UNIFI_PROVIDER,
        sync_type: 'full',
        error: message,
        failed_at: new Date().toISOString(),
      },
    });
    throw error;
  }
}

/** Single-device sync. Returns 'skipped' for unmapped sites / unsupported devices; throws on API/DB failure. */
export async function runUniFiDeviceSync(
  args: UniFiSyncArgs & { scopeKey: string; deviceId: string },
  deps: UniFiSyncDeps
): Promise<NormalizedRmmIngestionResult> {
  const ingest = deps.ingest ?? ingestNormalizedRmmDeviceSnapshot;
  const parsed = parseUniFiScopeKey(args.scopeKey);
  if (!parsed) {
    return { externalDeviceId: args.deviceId, action: 'skipped', error: 'Invalid UniFi site scope' };
  }
  const site = (await loadMappedSites(deps, args.tenant, args.integrationId)).find((s) => s.scopeKey === args.scopeKey);
  if (!site) {
    return { externalDeviceId: args.deviceId, action: 'skipped', error: 'UniFi site is not mapped to a client' };
  }

  const device = await deps.client.getDevice(site, args.deviceId);
  const snapshot = mapUniFiDeviceToSnapshot({
    integrationId: args.integrationId,
    device: { ...device, id: device.id ?? resolveExternalDeviceId({ id: args.deviceId, macAddress: device.macAddress }) },
    scopeKey: site.scopeKey,
    siteName: site.siteName,
  });
  if (!snapshot) {
    return { externalDeviceId: args.deviceId, action: 'skipped', error: 'Device is not an adopted gateway, switch or access point' };
  }

  const outcome = await ingest({ tenant: args.tenant, snapshot, resolvedClientId: site.clientId, knex: deps.knex });
  if (outcome.assetId) {
    await writeDeviceFacts(deps, {
      tenant: args.tenant,
      integrationId: args.integrationId,
      assetId: outcome.assetId,
      device,
      uplinkName: null,
    });
  }
  return outcome;
}
