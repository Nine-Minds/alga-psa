import { badRequest, dynamic, ok, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { discoverManagedTenantsForTenant } from '@enterprise/lib/integrations/entra/discoveryService';
import { entraRouteErrorMessage } from '../_errors';

export { dynamic, runtime };

export async function POST(): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  try {
    const discovered = await discoverManagedTenantsForTenant(accessGate.tenantId);
    return ok(discovered);
  } catch (error: unknown) {
    const message = entraRouteErrorMessage(error, 'Failed to discover managed Entra tenants.');
    return badRequest(message);
  }
}
