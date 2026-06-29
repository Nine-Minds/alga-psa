/**
 * Hudu tenant-wide import + sync core (EE-only, session-free).
 *
 * The single engine behind both the config-screen "Import all"/"Sync all"
 * actions and the daily auto-sync job: loop the tenant's mapped clients and,
 * per client, import every plain-unmatched Hudu asset (when importNew) then
 * refresh name/serial/fields on the mapped ones. Writes the RMM-style run
 * status to hudu_integrations (sync_status / last_full_sync_at) and a last-run
 * summary into settings.last_sync.
 *
 * Sessionless: asset writes are attributed to a resolved tenant audit user
 * (mirrors NinjaOne's getDefaultAuditUserId — first user in the tenant); the
 * manual actions pass the clicking user id instead.
 */

import logger from '@alga-psa/core/logger';
import { createTenantKnex } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { getHuduIntegration, setHuduSyncRunState } from './huduIntegrationRepository';
import { getHuduCompanyMappingRows } from './companyMapping';
import { importUnmatchedHuduAssetsCore } from './assetImportCore';
import { syncHuduClientAssetsCore } from './assetSyncCore';

export interface HuduAutoSyncDesiredState {
  isActive: boolean;
  autoSyncEnabled: boolean;
}

/**
 * Desired auto-sync state for a tenant, read from the EE-only hudu_integrations
 * row. Lives in EE so the CE-visible job handler never names the table (NFR7);
 * the handler/scheduler reach it via a dynamic @enterprise import.
 */
export async function getHuduAutoSyncDesiredState(
  tenant: string
): Promise<HuduAutoSyncDesiredState | null> {
  const { knex } = await createTenantKnex(tenant);
  const row = await getHuduIntegration(knex, tenant);
  if (!row) {
    return null;
  }
  const autoSync = (row.settings?.autoSync ?? {}) as Record<string, unknown>;
  return { isActive: row.is_active === true, autoSyncEnabled: autoSync.enabled === true };
}

export interface HuduTenantSyncSummary {
  sync_type: 'import' | 'sync';
  started_at: string;
  completed_at: string;
  clients: number;
  items_created: number;
  items_updated: number;
  items_skipped: number;
  items_failed: number;
  stale: number;
  errors: string[];
}

export interface RunHuduTenantSyncOptions {
  /** Create plain-unmatched assets (true) or only refresh existing (false). */
  importNew: boolean;
  /** Asset audit actor. Manual path passes the clicking user; omit to resolve one. */
  actorUserId?: string;
}

/**
 * Resolve a tenant user to attribute background asset writes to. Mirrors
 * NinjaOne's getDefaultAuditUserId (first user in the tenant), preferring an
 * internal user when present. Returns null when the tenant has no users.
 */
export async function resolveTenantAuditUserId(knex: Knex, tenant: string): Promise<string | null> {
  const internal = await knex('users')
    .where({ tenant, user_type: 'internal' })
    .orderBy('created_at', 'asc')
    .first('user_id');
  if (internal?.user_id) {
    return internal.user_id;
  }
  const any = await knex('users').where({ tenant }).first('user_id');
  return any?.user_id ?? null;
}

function emptySummary(importNew: boolean, startedAt: string): HuduTenantSyncSummary {
  return {
    sync_type: importNew ? 'import' : 'sync',
    started_at: startedAt,
    completed_at: startedAt,
    clients: 0,
    items_created: 0,
    items_updated: 0,
    items_skipped: 0,
    items_failed: 0,
    stale: 0,
    errors: [],
  };
}

/**
 * Run a tenant-wide Hudu import+sync. Clients are processed sequentially so a
 * mid-run Hudu rate limit on one client is recorded (partial counts + error)
 * without aborting the whole run. Per-client failures never throw out of the
 * loop. Returns the run summary; also persisted to settings.last_sync.
 */
export async function runHuduTenantSync(
  tenant: string,
  options: RunHuduTenantSyncOptions
): Promise<HuduTenantSyncSummary> {
  const startedAt = new Date().toISOString();
  const summary = emptySummary(options.importNew, startedAt);
  const { knex } = await createTenantKnex(tenant);

  const actorUserId = options.actorUserId ?? (await resolveTenantAuditUserId(knex, tenant));
  if (!actorUserId) {
    const completed = new Date().toISOString();
    summary.completed_at = completed;
    summary.errors.push('No tenant user found to attribute imported assets to.');
    await setHuduSyncRunState(knex, tenant, {
      status: 'error',
      error: summary.errors[0],
      lastFullSyncAt: completed,
      summary: summary as unknown as Record<string, unknown>,
    });
    return summary;
  }

  await setHuduSyncRunState(knex, tenant, { status: 'syncing' });

  try {
    const mappingRows = await getHuduCompanyMappingRows(knex, tenant);
    summary.clients = mappingRows.length;

    for (const mapping of mappingRows) {
      const clientId = mapping.alga_entity_id;

      if (options.importNew) {
        const imp = await importUnmatchedHuduAssetsCore(tenant, actorUserId, clientId);
        const counts = imp.success ? imp.data : imp.partial;
        summary.items_created += counts.created;
        summary.items_skipped += counts.skipped;
        summary.items_failed += counts.failed.length;
        if (!imp.success) {
          summary.errors.push(`${clientId}: ${imp.error}`);
        }
      }

      const syn = await syncHuduClientAssetsCore(tenant, actorUserId, clientId);
      if (syn.state === 'ok') {
        summary.items_updated += syn.updated;
        summary.stale += syn.stale;
      } else if (syn.state === 'error') {
        summary.errors.push(`${clientId}: ${syn.error}`);
      }
    }

    const completed = new Date().toISOString();
    summary.completed_at = completed;

    await setHuduSyncRunState(knex, tenant, {
      // The run finished; per-item/per-client problems are reported in sync_error.
      status: 'completed',
      error: summary.errors.length > 0 ? summary.errors.slice(0, 5).join('; ') : null,
      lastFullSyncAt: completed,
      summary: summary as unknown as Record<string, unknown>,
    });

    logger.info('[HuduTenantSync] run finished', {
      tenant,
      sync_type: summary.sync_type,
      clients: summary.clients,
      created: summary.items_created,
      updated: summary.items_updated,
      skipped: summary.items_skipped,
      failed: summary.items_failed,
      errors: summary.errors.length,
    });

    return summary;
  } catch (error) {
    const completed = new Date().toISOString();
    summary.completed_at = completed;
    const message = error instanceof Error ? error.message : String(error);
    summary.errors.push(message);
    await setHuduSyncRunState(knex, tenant, {
      status: 'error',
      error: message,
      lastFullSyncAt: completed,
      summary: summary as unknown as Record<string, unknown>,
    });
    logger.error('[HuduTenantSync] run failed', { tenant, error: message });
    return summary;
  }
}
