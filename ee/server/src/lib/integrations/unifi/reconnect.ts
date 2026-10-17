import { getAdminConnection } from '@alga-psa/db/admin';

const PROVIDER = 'unifi';

/**
 * Records that UniFi rejected the stored key. `tokenLifecycle.status` is the
 * shape the alert-polling and device-sync gates already honour, so scheduled
 * runs stop hammering a dead key until the MSP reconnects.
 */
export async function markUniFiReconnectRequired(tenant: string): Promise<void> {
  const knex = await getAdminConnection();
  // Single atomic jsonb merge: a read-modify-write of the whole settings blob
  // would clobber a concurrent unifiOfflineObservations write or a settings save.
  await knex.raw(
    `UPDATE rmm_integrations
        SET settings = COALESCE(settings, '{}'::jsonb)
              || jsonb_build_object(
                   'reconnectRequired', true,
                   'tokenLifecycle',
                   COALESCE(settings->'tokenLifecycle', '{}'::jsonb)
                     || jsonb_build_object('status', 'reconnect_required', 'updatedAt', ?::text)
                 ),
            updated_at = now()
      WHERE tenant = ? AND provider = ?`,
    [new Date().toISOString(), tenant, PROVIDER]
  );
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
