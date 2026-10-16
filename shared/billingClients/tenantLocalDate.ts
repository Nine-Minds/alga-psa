import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toLocalDateInTimeZone } from './clientContractStatus';

// LEVERAGE: pattern tenant-timezone-loader — same tenant_settings.settings.timezone read as
// packages/tickets/src/lib/recurring/tenantTimeZone.ts and tenancy's getTenantTimezone; a shared
// low-level tenant timezone reader is missing (tenancy sits above shared).
/**
 * Tenant IANA timezone from `tenant_settings.settings.timezone`, or null when unset/unreadable.
 */
export async function loadTenantTimeZone(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<string | null> {
  try {
    const row = await tenantDb(conn, tenant).table('tenant_settings').select('settings').first();
    let settings: unknown = row?.settings;
    if (typeof settings === 'string') {
      settings = JSON.parse(settings);
    }
    const timezone = (settings as { timezone?: unknown } | null | undefined)?.timezone;
    return typeof timezone === 'string' && timezone.length > 0 ? timezone : null;
  } catch {
    return null;
  }
}

/**
 * Today's calendar date (YYYY-MM-DD) in the tenant's timezone. When the tenant has no timezone
 * configured the UTC date is used (documented fallback).
 */
export async function getTenantLocalToday(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<string> {
  return toLocalDateInTimeZone(new Date(), await loadTenantTimeZone(conn, tenant));
}
