import type { Knex } from 'knex';

/**
 * Check whether response state tracking is enabled for a tenant.
 * Lightweight helper for use in server-side code that already has a knex/trx instance.
 * Reads from tenant_settings.ticket_display_settings JSONB with fallback to nested settings path.
 */
export async function isResponseStateTrackingEnabled(tenant: string, knex: Knex): Promise<boolean> {
  const row = await knex('tenant_settings')
    .select('ticket_display_settings', 'settings')
    .where({ tenant })
    .first();

  const fromColumn = (row?.ticket_display_settings as any) || {};
  const nested = ((row?.settings as any)?.ticketing?.display) || {};
  const display = Object.keys(fromColumn).length ? fromColumn : nested;

  return display.responseStateTrackingEnabled ?? true;
}
