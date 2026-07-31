// LEVERAGE: friction workdate-dup — near-verbatim copy of packages/db/src/lib/workDate.ts.
// Two copies of the same temporal helpers drift independently (truncateToMinute had to be
// added in both). A single shared module would remove the parallel-maintenance tax.
import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';
import { tenantDb } from '@alga-psa/db';

export function normalizeIanaTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    Temporal.TimeZone.from(timeZone);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function toTemporalInstant(value: string | Date): Temporal.Instant {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      throw new Error('Invalid Date value');
    }
    return Temporal.Instant.from(value.toISOString());
  }

  try {
    return Temporal.Instant.from(value);
  } catch {
    const jsDate = new Date(value);
    if (isNaN(jsDate.getTime())) {
      throw new Error(`Invalid date value: ${value}`);
    }
    return Temporal.Instant.from(jsDate.toISOString());
  }
}

export function computeWorkDateFields(startTime: string | Date, timeZone: string | null | undefined): {
  work_date: string;
  work_timezone: string;
} {
  const tz = normalizeIanaTimeZone(timeZone);
  const instant = toTemporalInstant(startTime);
  return {
    work_timezone: tz,
    work_date: instant.toZonedDateTimeISO(tz).toPlainDate().toString(),
  };
}

/**
 * Truncate an instant down to the minute (drop seconds and milliseconds).
 *
 * Time entries are authored and displayed at minute granularity (HH:MM pickers,
 * whole-minute durations), but several write paths stamp real wall-clock instants —
 * most notably the start/stop timer — leaving stray seconds behind. When start and
 * end land on different seconds, a genuine 29m29s span renders as a clean
 * 10:30–11:00 yet rounds to 29: the "off by one minute" duration bug. Normalizing on
 * write keeps the stored instant consistent with what the UI shows. Seconds are
 * timezone invariant, so flooring the epoch to the minute is unambiguous across zones.
 */
export function truncateToMinute(value: string | Date): Date {
  const epochMs = toTemporalInstant(value).epochMilliseconds;
  return new Date(Math.floor(epochMs / 60000) * 60000);
}

export async function resolveUserTimeZone(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string> {
  const row = await tenantDb(knexOrTrx, tenant).table('users')
    .where({ user_id: userId })
    .select('timezone')
    .first();
  return normalizeIanaTimeZone(row?.timezone ?? null);
}

/**
 * Resolve the effective timezone for a user within a tenant.
 * Resolution chain: user timezone -> tenant timezone -> UTC.
 */
export async function resolveEffectiveTimeZone(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  userId?: string | null
): Promise<string> {
  // 1. Try user timezone if userId provided
  if (userId) {
    const userRow = await tenantDb(knexOrTrx, tenant).table('users')
      .where({ user_id: userId })
      .select('timezone')
      .first();
    if (userRow?.timezone) {
      return normalizeIanaTimeZone(userRow.timezone);
    }
  }

  // 2. Try tenant timezone from settings JSONB
  const settingsRow = await tenantDb(knexOrTrx, tenant).table('tenant_settings')
    .select('settings')
    .first();
  const tenantTz = settingsRow?.settings?.timezone;
  if (tenantTz && typeof tenantTz === 'string') {
    return normalizeIanaTimeZone(tenantTz);
  }

  // 3. Fall back to UTC
  return 'UTC';
}
