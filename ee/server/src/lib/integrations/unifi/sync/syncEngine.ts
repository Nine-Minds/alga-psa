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
import type { RmmSyncResult } from '../../../../interfaces/rmm.interfaces';
import type { UniFiApiClient } from '../unifiApiClient';

export const UNIFI_PROVIDER = 'unifi' as const;

type UniFiSyncEventName = 'RMM_SYNC_STARTED' | 'RMM_SYNC_COMPLETED' | 'RMM_SYNC_FAILED';

export interface UniFiSyncDeps {
  knex: Knex;
  client: UniFiApiClient;
  ingest?: typeof ingestNormalizedRmmDeviceSnapshot;
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
