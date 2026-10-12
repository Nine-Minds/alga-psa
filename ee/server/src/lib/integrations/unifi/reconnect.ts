import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin.js';

const PROVIDER = 'unifi';

/**
 * Records that UniFi rejected the stored key. `tokenLifecycle.status` is the
 * shape the alert-polling and device-sync gates already honour, so scheduled
 * runs stop hammering a dead key until the MSP reconnects.
 */
export async function markUniFiReconnectRequired(tenant: string): Promise<void> {
  const knex = await getAdminConnection();
  const db = tenantDb(knex, tenant);
  const row = await db.table('rmm_integrations').where({ provider: PROVIDER }).first('settings');
  if (!row) return;
  const current = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings ?? {};
  const next = {
    ...current,
    reconnectRequired: true,
    tokenLifecycle: { ...(current.tokenLifecycle ?? {}), status: 'reconnect_required', updatedAt: new Date().toISOString() },
  };
  await db
    .table('rmm_integrations')
    .where({ provider: PROVIDER })
    .update({ settings: JSON.stringify(next), updated_at: knex.fn.now() });
}

/** Removes the reconnect marker after a successful key save / connection test. */
export function clearReconnectRequired<T extends Record<string, unknown>>(settings: T): T {
  const next: Record<string, unknown> = { ...settings };
  delete next.reconnectRequired;
  const lifecycle = { ...((next.tokenLifecycle as Record<string, unknown> | undefined) ?? {}) };
  if (lifecycle.status === 'reconnect_required') delete lifecycle.status;
  next.tokenLifecycle = lifecycle;
  return next as T;
}
