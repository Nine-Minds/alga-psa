/**
 * hudu_integrations repository (EE-only).
 *
 * Tenant-scoped knex access to the EE-only `hudu_integrations` connection-state
 * table (one row per tenant, enforced by unique(tenant)). Mirrors the Entra
 * repository style of taking an explicit Knex handle so callers (server
 * actions, routes, tests) control the connection/transaction.
 *
 * EE/CE boundary (NFR7): this module is the ONLY place that reads/writes
 * `hudu_integrations`. CE code must never name the table — it does not exist
 * in CE databases. Mapping rows live in the shared CE table
 * `tenant_external_entity_mappings` and are managed elsewhere.
 */

import type { Knex } from 'knex';

/** Tenant-wide import/sync run status (mirrors rmm_integrations.sync_status). */
export type HuduSyncStatus = 'idle' | 'syncing' | 'completed' | 'error';

export interface HuduIntegrationRecord {
  tenant: string;
  integration_id: string;
  base_url: string | null;
  is_active: boolean;
  connected_at: Date | string | null;
  last_synced_at: Date | string | null;
  /** Status of the last tenant-wide import/sync run. */
  sync_status: HuduSyncStatus;
  sync_error: string | null;
  /** Timestamp of the last tenant-wide import/sync run. */
  last_full_sync_at: Date | string | null;
  settings: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface UpsertHuduIntegrationInput {
  base_url?: string | null;
  is_active?: boolean;
  connected_at?: Date | string | null;
  last_synced_at?: Date | string | null;
  settings?: Record<string, unknown>;
}

const TABLE = 'hudu_integrations';

export async function getHuduIntegration(
  knex: Knex,
  tenant: string
): Promise<HuduIntegrationRecord | null> {
  const row = await knex<HuduIntegrationRecord>(TABLE).where({ tenant }).first();
  return row ?? null;
}

/**
 * Insert-or-update the tenant's single connection row (conflict on the
 * unique(tenant) constraint), returning the resulting row.
 */
export async function upsertHuduIntegration(
  knex: Knex,
  tenant: string,
  input: UpsertHuduIntegrationInput
): Promise<HuduIntegrationRecord> {
  const values: Record<string, unknown> = { tenant };
  // Bind a literal Date, not knex.fn.now(): hudu_integrations is a distributed
  // Citus table and a now() call in ON CONFLICT DO UPDATE SET is rejected as
  // non-IMMUTABLE. A constant timestamp value is safe.
  const merge: Record<string, unknown> = { updated_at: new Date() };

  if (input.base_url !== undefined) {
    values.base_url = input.base_url;
    merge.base_url = input.base_url;
  }
  if (input.is_active !== undefined) {
    values.is_active = input.is_active;
    merge.is_active = input.is_active;
  }
  if (input.connected_at !== undefined) {
    values.connected_at = input.connected_at;
    merge.connected_at = input.connected_at;
  }
  if (input.last_synced_at !== undefined) {
    values.last_synced_at = input.last_synced_at;
    merge.last_synced_at = input.last_synced_at;
  }
  if (input.settings !== undefined) {
    values.settings = JSON.stringify(input.settings);
    merge.settings = JSON.stringify(input.settings);
  }

  const rows = await knex(TABLE)
    .insert(values)
    .onConflict(['tenant'])
    .merge(merge)
    .returning('*');

  return rows[0] as HuduIntegrationRecord;
}

export async function setHuduIntegrationActive(
  knex: Knex,
  tenant: string,
  isActive: boolean
): Promise<void> {
  await knex(TABLE).where({ tenant }).update({
    is_active: isActive,
    updated_at: knex.fn.now(),
  });
}

export async function touchHuduIntegrationLastSynced(
  knex: Knex,
  tenant: string,
  at?: Date | string
): Promise<void> {
  await knex(TABLE)
    .where({ tenant })
    .update({
      last_synced_at: at ?? knex.fn.now(),
      updated_at: knex.fn.now(),
    });
}

/**
 * Shallow-merge a patch into the settings jsonb, preserving sibling keys
 * (companies_cache / asset_layout_type_map / password_access). The `||`
 * operator is IMMUTABLE-safe on the distributed table (no now()).
 */
export async function mergeHuduSettings(
  knex: Knex,
  tenant: string,
  patch: Record<string, unknown>
): Promise<void> {
  await knex(TABLE)
    .where({ tenant })
    .update({
      settings: knex.raw(`coalesce(settings, '{}'::jsonb) || ?::jsonb`, [JSON.stringify(patch)]),
      updated_at: knex.fn.now(),
    });
}

export interface HuduSyncRunState {
  status: HuduSyncStatus;
  error?: string | null;
  /** Stamp last_full_sync_at; pass a value on terminal states. */
  lastFullSyncAt?: Date | string | null;
  /** Persisted under settings.last_sync (preserving sibling settings keys). */
  summary?: Record<string, unknown>;
}

/**
 * Record tenant-wide run progress: set the status columns and (on completion)
 * the last-run summary. Status 'syncing' clears any prior error; terminal
 * states also stamp last_full_sync_at and the summary blob.
 */
export async function setHuduSyncRunState(
  knex: Knex,
  tenant: string,
  state: HuduSyncRunState
): Promise<void> {
  const update: Record<string, unknown> = {
    sync_status: state.status,
    updated_at: knex.fn.now(),
  };
  if (state.error !== undefined) {
    update.sync_error = state.error;
  } else if (state.status === 'syncing') {
    update.sync_error = null;
  }
  if (state.lastFullSyncAt !== undefined) {
    update.last_full_sync_at = state.lastFullSyncAt;
  }
  if (state.summary !== undefined) {
    update.settings = knex.raw(`coalesce(settings, '{}'::jsonb) || ?::jsonb`, [
      JSON.stringify({ last_sync: state.summary }),
    ]);
  }
  await knex(TABLE).where({ tenant }).update(update);
}
