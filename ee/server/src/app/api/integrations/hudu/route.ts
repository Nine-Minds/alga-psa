import { createTenantKnex } from 'server/src/lib/db';
import { getHuduIntegration } from '../../../../lib/integrations/hudu/huduIntegrationRepository';
import { dynamic, ok, runtime } from './_responses';
import { requireHuduUiFlagEnabled } from './_guards';

export { dynamic, runtime };

/**
 * GET /api/integrations/hudu — Hudu connection status (EE-only).
 *
 * Gates on EE + `hudu-integration` flag + `system_settings` read, then returns
 * the tenant's hudu_integrations connection state. SECURITY: the payload never
 * contains the api key — connection metadata only.
 */
export async function GET(): Promise<Response> {
  const flagGate = await requireHuduUiFlagEnabled('read');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const { knex } = await createTenantKnex(flagGate.tenantId);
  const row = await getHuduIntegration(knex, flagGate.tenantId);

  if (!row || !row.is_active) {
    return ok({
      status: 'not_connected',
      baseUrl: row?.base_url ?? null,
      connectedAt: null,
      lastSyncedAt: null,
      passwordAccess: false,
    });
  }

  const toIso = (value: Date | string | null): string | null =>
    value === null ? null : value instanceof Date ? value.toISOString() : String(value);

  return ok({
    status: 'connected',
    baseUrl: row.base_url,
    connectedAt: toIso(row.connected_at),
    lastSyncedAt: toIso(row.last_synced_at),
    passwordAccess: row.settings?.password_access === true,
  });
}
