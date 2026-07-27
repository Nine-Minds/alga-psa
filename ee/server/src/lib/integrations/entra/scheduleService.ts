import { createTenantKnex, runWithTenant } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import { applyEntraSyncSchedule } from './entraWorkflowClient';

/**
 * The sync schedule, as a thing an operator can actually set.
 *
 * `entra_sync_settings` has carried sync_enabled and sync_interval_minutes
 * since phase 1, but nothing ever wrote them: the screen showed the interval
 * read-only and the Temporal schedule was only reconciled at worker boot. So a
 * tenant could neither turn automatic sync on nor pause it, and a change made
 * directly in the database took effect whenever the worker next restarted.
 *
 * Saving here writes the settings and reconciles the tenant's schedule
 * immediately, so "paused" means paused now.
 */

export const ENTRA_SYNC_INTERVAL_CHOICES = [60, 240, 720, 1440, 10080] as const;

const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 43200;

export interface EntraSyncScheduleSettings {
  syncEnabled: boolean;
  syncIntervalMinutes: number;
  updatedAt: string | null;
}

export function normalizeEntraSyncIntervalMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1440;
  }
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.trunc(parsed)));
}

export async function getEntraSyncSchedule(tenantId: string): Promise<EntraSyncScheduleSettings> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const row = await tenantDb(knex, tenantId).table('entra_sync_settings')
      .first(['sync_enabled', 'sync_interval_minutes', 'updated_at']);

    return {
      // Absent settings mean off: automatic sync is opted into, never inherited.
      syncEnabled: Boolean(row?.sync_enabled),
      syncIntervalMinutes: normalizeEntraSyncIntervalMinutes(row?.sync_interval_minutes ?? 1440),
      updatedAt: row?.updated_at
        ? (row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at))
        : null,
    };
  });
}

export async function saveEntraSyncSchedule(params: {
  tenantId: string;
  syncEnabled: boolean;
  syncIntervalMinutes: number;
}): Promise<EntraSyncScheduleSettings & { scheduleApplied: boolean; scheduleError: string | null }> {
  const syncIntervalMinutes = normalizeEntraSyncIntervalMinutes(params.syncIntervalMinutes);

  await runWithTenant(params.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = new Date().toISOString();

    await tenantDb(knex, params.tenantId).table('entra_sync_settings')
      .insert({
        tenant: params.tenantId,
        sync_enabled: params.syncEnabled,
        sync_interval_minutes: syncIntervalMinutes,
        updated_at: now,
      })
      .onConflict('tenant')
      .merge({
        sync_enabled: params.syncEnabled,
        sync_interval_minutes: syncIntervalMinutes,
        updated_at: now,
      });
  });

  // The settings row is the source of truth; the schedule is derived from it and
  // reconciled at worker boot too, so a failure here degrades to "takes effect
  // on the next worker restart" rather than losing the setting.
  const scheduleResult = await applyEntraSyncSchedule({
    tenantId: params.tenantId,
    syncEnabled: params.syncEnabled,
    syncIntervalMinutes,
  });

  const saved = await getEntraSyncSchedule(params.tenantId);
  return {
    ...saved,
    scheduleApplied: scheduleResult.applied,
    scheduleError: scheduleResult.error || null,
  };
}
