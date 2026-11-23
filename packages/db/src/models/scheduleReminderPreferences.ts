import type { Knex } from 'knex';
import { tenantDb } from '../lib/tenantDb';

/**
 * Per-user schedule reminder lead times, stored server-side in `user_preferences`
 * (setting `schedule_reminder_lead_minutes`, a JSON array of minutes). Shared by web, mobile and Teams.
 *
 * Semantics: unset or unparseable -> default `[15]`; an explicitly stored `[]` -> `[]` (reminders off).
 */
export const SCHEDULE_REMINDER_LEAD_SETTING = 'schedule_reminder_lead_minutes';
export const ALLOWED_SCHEDULE_REMINDER_LEAD_MINUTES: readonly number[] = [0, 5, 10, 15, 30, 60];
export const DEFAULT_SCHEDULE_REMINDER_LEAD_MINUTES: readonly number[] = [15];

/** Keep allowed integers, dedupe, sort ascending. Unset/unparseable raw input yields the default. */
export function normalizeScheduleReminderLeadMinutes(raw: unknown): number[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [...DEFAULT_SCHEDULE_REMINDER_LEAD_MINUTES];
    }
  }
  if (!Array.isArray(value)) return [...DEFAULT_SCHEDULE_REMINDER_LEAD_MINUTES];
  const kept = new Set<number>();
  for (const entry of value) {
    if (typeof entry === 'number' && ALLOWED_SCHEDULE_REMINDER_LEAD_MINUTES.includes(entry)) kept.add(entry);
  }
  return [...kept].sort((a, b) => a - b);
}

export async function getScheduleReminderLeadMinutes(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
): Promise<number[]> {
  const byUser = await getScheduleReminderLeadMinutesForUsers(knex, tenant, [userId]);
  return byUser.get(userId) ?? [...DEFAULT_SCHEDULE_REMINDER_LEAD_MINUTES];
}

/** Batch read for the scan: every requested user appears in the result (default when unset). */
export async function getScheduleReminderLeadMinutesForUsers(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userIds: readonly string[],
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const unique = [...new Set(userIds)];
  for (const id of unique) result.set(id, [...DEFAULT_SCHEDULE_REMINDER_LEAD_MINUTES]);
  if (unique.length === 0) return result;
  const rows: Array<{ user_id: string; setting_value: unknown }> = await tenantDb(knex, tenant)
    .table('user_preferences')
    .where({ setting_name: SCHEDULE_REMINDER_LEAD_SETTING })
    .whereIn('user_id', unique)
    .select('user_id', 'setting_value');
  for (const row of rows) result.set(row.user_id, normalizeScheduleReminderLeadMinutes(row.setting_value));
  return result;
}

/** Normalizes before writing; returns what was stored. */
export async function setScheduleReminderLeadMinutes(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
  values: unknown,
): Promise<number[]> {
  const normalized = Array.isArray(values) ? normalizeScheduleReminderLeadMinutes(values) : [...DEFAULT_SCHEDULE_REMINDER_LEAD_MINUTES];
  const now = new Date();
  await tenantDb(knex, tenant)
    .table('user_preferences')
    .insert({
      tenant,
      user_id: userId,
      setting_name: SCHEDULE_REMINDER_LEAD_SETTING,
      // jsonb: stringify, otherwise pg would send a JS array as a Postgres array literal.
      setting_value: JSON.stringify(normalized),
      updated_at: now,
    })
    .onConflict(['tenant', 'user_id', 'setting_name'])
    .merge({ setting_value: JSON.stringify(normalized), updated_at: now });
  return normalized;
}
