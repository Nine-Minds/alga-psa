import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraUiFlagEnabled } from '../_guards';
import { discoverManagedTenantsForTenant } from '@enterprise/lib/integrations/entra/discoveryService';

export { dynamic, runtime };

export async function POST(): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('update');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  try {
    const discovered = await discoverManagedTenantsForTenant(flagGate.tenantId);
    return ok(discovered);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to discover managed Entra tenants.';
    return badRequest(message);
  }
}
