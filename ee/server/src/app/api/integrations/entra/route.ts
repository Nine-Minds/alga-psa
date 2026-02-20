import { dynamic, ok, runtime } from './_responses';
import { requireEntraUiFlagEnabled } from './_guards';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled();
  if (flagGate instanceof Response) {
    return flagGate;
  }

  return ok({
    status: 'not_connected',
    connectionType: null,
    lastDiscoveryAt: null,
    mappedTenantCount: 0,
    availableConnectionTypes: ['direct', 'cipp'],
  });
}
