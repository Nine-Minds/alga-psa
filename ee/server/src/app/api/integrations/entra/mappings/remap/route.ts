import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { confirmEntraMappings } from '@/lib/integrations/entra/mapping/confirmMappingsService';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('update');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const body = await parseJsonBody(request);
  const managedTenantId =
    typeof body.managedTenantId === 'string' ? body.managedTenantId.trim() : '';
  const targetClientId =
    typeof body.targetClientId === 'string' ? body.targetClientId.trim() : '';

  if (!managedTenantId) {
    return badRequest('managedTenantId is required.');
  }

  if (!targetClientId) {
    return badRequest('targetClientId is required.');
  }

  const result = await confirmEntraMappings({
    tenant: flagGate.tenantId,
    userId: flagGate.userId,
    mappings: [
      {
        managedTenantId,
        clientId: targetClientId,
        mappingState: 'mapped',
      },
    ],
  });

  return ok({
    managedTenantId,
    targetClientId,
    status: 'remapped',
    confirmedMappings: result.confirmedMappings,
  });
}
