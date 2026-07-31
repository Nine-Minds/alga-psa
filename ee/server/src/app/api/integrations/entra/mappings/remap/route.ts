import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { confirmEntraMappings } from '@enterprise/lib/integrations/entra/mapping/confirmMappingsService';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
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
    tenant: accessGate.tenantId,
    userId: accessGate.userId,
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
