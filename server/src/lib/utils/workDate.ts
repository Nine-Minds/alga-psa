import { Knex } from 'knex';
import { Temporal } from '@js-temporal/polyfill';

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

export async function resolveUserTimeZone(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  userId: string
): Promise<string> {
  const row = await knexOrTrx('users')
    .where({ tenant, user_id: userId })
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
    const userRow = await knexOrTrx('users')
      .where({ tenant, user_id: userId })
      .select('timezone')
      .first();
    if (userRow?.timezone) {
      return normalizeIanaTimeZone(userRow.timezone);
    }
  }

  // 2. Try tenant timezone from settings JSONB
  const settingsRow = await knexOrTrx('tenant_settings')
    .where({ tenant })
    .select('settings')
    .first();
  const tenantTz = settingsRow?.settings?.timezone;
  if (tenantTz && typeof tenantTz === 'string') {
    return normalizeIanaTimeZone(tenantTz);
  }

  // 3. Fall back to UTC
  return 'UTC';
}

