import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { confirmEntraMappings, type ConfirmEntraMappingInput } from '@/lib/integrations/entra/mapping/confirmMappingsService';
import { findManagedTenantAssignmentConflicts } from '@/lib/integrations/entra/mapping/validation';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled();
  if (flagGate instanceof Response) {
    return flagGate;
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

  const result = await confirmEntraMappings({
    tenant: flagGate.tenantId,
    userId: flagGate.userId,
    mappings: normalizedMappings,
  });

  return ok(result);
}
