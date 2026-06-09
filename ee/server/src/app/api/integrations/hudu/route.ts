import { dynamic, ok, runtime } from './_responses';
import { requireHuduUiFlagEnabled } from './_guards';

export { dynamic, runtime };

/**
 * GET /api/integrations/hudu — Hudu connection status (EE-only).
 *
 * Phase 1 skeleton: gates on EE + `hudu-integration` flag + `system_settings`
 * read, then returns a minimal status envelope. Deeper logic lands in later
 * commit groups.
 */
export async function GET(): Promise<Response> {
  const flagGate = await requireHuduUiFlagEnabled('read');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  // TODO(connection): load hudu_integrations row for flagGate.tenantId and
  // return real status (connected_at, last_synced_at, password-access capability).
  return ok({
    status: 'not_connected',
    connectedAt: null,
    lastSyncedAt: null,
  });
}
