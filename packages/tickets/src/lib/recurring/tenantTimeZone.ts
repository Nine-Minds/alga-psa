import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Used when a tenant has not configured a timezone; matches the sweep handler's default. */
export const DEFAULT_RECURRING_TIME_ZONE = 'UTC';

/**
 * The tenant's IANA timezone from `tenant_settings.settings.timezone` (the value `getTenantTimezone`
 * in the tenancy package reads). Create and due times of recurring tickets are wall-clock in it.
 * Read directly here because the tickets package does not depend on tenancy.
 */
export async function loadTenantTimeZone(conn: Knex | Knex.Transaction, tenant: string): Promise<string> {
  const row = await tenantDb(conn, tenant).table('tenant_settings').select('settings').first();
  const settings = typeof row?.settings === 'string' ? safeParse(row.settings) : row?.settings;
  const timezone = (settings as { timezone?: unknown } | null | undefined)?.timezone;
  return typeof timezone === 'string' && timezone.length > 0 ? timezone : DEFAULT_RECURRING_TIME_ZONE;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
