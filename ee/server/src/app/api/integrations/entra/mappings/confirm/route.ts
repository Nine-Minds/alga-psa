import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { confirmEntraMappings, type ConfirmEntraMappingInput } from '@enterprise/lib/integrations/entra/mapping/confirmMappingsService';
import { findManagedTenantAssignmentConflicts } from '@enterprise/lib/integrations/entra/mapping/validation';
import { hasPermission } from '@alga-psa/auth/rbac';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await parseJsonBody(request);
  const mappings = Array.isArray(body.mappings) ? body.mappings : null;

  if (!mappings) {
    return badRequest('mappings must be an array');
  }

  const normalizedMappings: ConfirmEntraMappingInput[] = mappings.map((mapping) => {
    const raw = mapping as Record<string, unknown>;
    return {
      managedTenantId: String(raw.managedTenantId || raw.managed_tenant_id || ''),
      clientId:
        raw.clientId === null || raw.client_id === null
          ? null
          : String(raw.clientId || raw.client_id || ''),
      mappingState: typeof raw.mappingState === 'string'
        ? (raw.mappingState as ConfirmEntraMappingInput['mappingState'])
        : undefined,
      confidenceScore:
        typeof raw.confidenceScore === 'number'
          ? raw.confidenceScore
          : typeof raw.confidence_score === 'number'
            ? raw.confidence_score
            : null,
    };
  });

  const conflicts = findManagedTenantAssignmentConflicts(normalizedMappings);
  if (conflicts.length > 0) {
    return badRequest(conflicts[0].message);
  }

  const invalidMappedDecision = normalizedMappings.find(
    (mapping) => mapping.mappingState === 'mapped' && !mapping.clientId
  );
  if (invalidMappedDecision) {
    return badRequest('A mapped Entra tenant decision requires a client ID.');
  }

  if (normalizedMappings.some((mapping) => mapping.mappingState === 'create_new')) {
    const canCreateClient = await hasPermission(accessGate.user, 'client', 'create');
    if (!canCreateClient) {
      return Response.json(
        { success: false, error: 'Forbidden: insufficient permissions to create clients' },
        { status: 403 }
      );
    }
  }

  const result = await confirmEntraMappings({
    tenant: accessGate.tenantId,
    userId: accessGate.userId,
    mappings: normalizedMappings,
  });

  return ok(result);
}
