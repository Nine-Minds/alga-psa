import type { ConfirmEntraMappingInput } from './confirmMappingsService';

export interface EntraMappingConflict {
  managedTenantId: string;
  clientIds: string[];
  message: string;
}

export function findManagedTenantAssignmentConflicts(
  mappings: ConfirmEntraMappingInput[]
): EntraMappingConflict[] {
  const clientIdsByManagedTenant = new Map<string, Set<string>>();

  for (const mapping of mappings) {
    const managedTenantId = String(mapping.managedTenantId || '').trim();
    const clientId = mapping.clientId ? String(mapping.clientId).trim() : '';

    if (!managedTenantId || !clientId) {
      continue;
    }

    if (!clientIdsByManagedTenant.has(managedTenantId)) {
      clientIdsByManagedTenant.set(managedTenantId, new Set<string>());
    }

    clientIdsByManagedTenant.get(managedTenantId)?.add(clientId);
  }

  const conflicts: EntraMappingConflict[] = [];
  for (const [managedTenantId, clientIdsSet] of clientIdsByManagedTenant.entries()) {
    const clientIds = Array.from(clientIdsSet.values());
    if (clientIds.length > 1) {
      conflicts.push({
        managedTenantId,
        clientIds,
        message:
          `Managed tenant ${managedTenantId} is assigned to multiple clients in one request: ` +
          `${clientIds.join(', ')}`,
      });
    }
  }

  return conflicts;
}
