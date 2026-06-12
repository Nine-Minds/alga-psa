import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { confirmEntraMappings, type ConfirmEntraMappingInput } from '@enterprise/lib/integrations/entra/mapping/confirmMappingsService';
import { findManagedTenantAssignmentConflicts } from '@enterprise/lib/integrations/entra/mapping/validation';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';
import { getActiveEntraPartnerConnection } from '@enterprise/lib/integrations/entra/connectionRepository';
import { getEntraProviderAdapter } from '@enterprise/lib/integrations/entra/providers';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('update');
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
      clientPortalEntraProvisioningMode:
        typeof raw.clientPortalEntraProvisioningMode === 'string'
          ? (raw.clientPortalEntraProvisioningMode as ConfirmEntraMappingInput['clientPortalEntraProvisioningMode'])
          : typeof raw.client_portal_entra_provisioning_mode === 'string'
            ? (raw.client_portal_entra_provisioning_mode as ConfirmEntraMappingInput['clientPortalEntraProvisioningMode'])
            : undefined,
      clientPortalEntitlementGroupId:
        raw.clientPortalEntitlementGroupId === null || raw.client_portal_entitlement_group_id === null
          ? null
          : typeof raw.clientPortalEntitlementGroupId === 'string'
            ? raw.clientPortalEntitlementGroupId
            : typeof raw.client_portal_entitlement_group_id === 'string'
              ? raw.client_portal_entitlement_group_id
              : undefined,
      clientPortalEntitlementMembershipMode:
        raw.clientPortalEntitlementMembershipMode === 'transitive'
          ? 'transitive'
          : raw.client_portal_entitlement_membership_mode === 'transitive'
            ? 'transitive'
            : undefined,
      clientPortalDefaultRoleName:
        raw.clientPortalDefaultRoleName === null || raw.client_portal_default_role_name === null
          ? null
          : typeof raw.clientPortalDefaultRoleName === 'string'
            ? raw.clientPortalDefaultRoleName
            : typeof raw.client_portal_default_role_name === 'string'
              ? raw.client_portal_default_role_name
              : undefined,
      clientPortalWorkflowTarget:
        raw.clientPortalWorkflowTarget === null || raw.client_portal_workflow_target === null
          ? null
          : typeof raw.clientPortalWorkflowTarget === 'string'
            ? raw.clientPortalWorkflowTarget
            : typeof raw.client_portal_workflow_target === 'string'
              ? raw.client_portal_workflow_target
              : undefined,
      clientPortalWorkflowConfig:
        raw.clientPortalWorkflowConfig === null || raw.client_portal_workflow_config === null
          ? null
          : raw.clientPortalWorkflowConfig && typeof raw.clientPortalWorkflowConfig === 'object' && !Array.isArray(raw.clientPortalWorkflowConfig)
          ? (raw.clientPortalWorkflowConfig as Record<string, unknown>)
          : raw.client_portal_workflow_config && typeof raw.client_portal_workflow_config === 'object' && !Array.isArray(raw.client_portal_workflow_config)
            ? (raw.client_portal_workflow_config as Record<string, unknown>)
            : undefined,
    };
  });

  const conflicts = findManagedTenantAssignmentConflicts(normalizedMappings);
  if (conflicts.length > 0) {
    return badRequest(conflicts[0].message);
  }

  const defaultRoleNames = Array.from(
    new Set(
      normalizedMappings
        .map((mapping) => mapping.clientPortalDefaultRoleName?.trim())
        .filter((roleName): roleName is string => Boolean(roleName))
    )
  );
  if (defaultRoleNames.length > 0) {
    const roleRows = await runWithTenant(flagGate.tenantId, async () => {
      const { knex } = await createTenantKnex();
      return knex('roles')
        .where({
          tenant: flagGate.tenantId,
          client: true,
        })
        .select(['role_name']);
    });
    const knownRoleNames = new Set(
      roleRows.map((row: { role_name?: string }) => String(row.role_name || '').toLowerCase())
    );
    const missingRoleName = defaultRoleNames.find(
      (roleName) => !knownRoleNames.has(roleName.toLowerCase())
    );
    if (missingRoleName) {
      return badRequest(`Client portal default role "${missingRoleName}" must be an existing client portal role.`);
    }
  }

  const mappingsWithEntitlementGroup = normalizedMappings.filter(
    (mapping) => typeof mapping.clientPortalEntitlementGroupId === 'string' && mapping.clientPortalEntitlementGroupId.trim().length > 0
  );
  if (mappingsWithEntitlementGroup.length > 0) {
    const managedTenantRows = await runWithTenant(flagGate.tenantId, async () => {
      const { knex } = await createTenantKnex();
      const managedTenantIds = Array.from(
        new Set(mappingsWithEntitlementGroup.map((mapping) => mapping.managedTenantId))
      );
      return knex('entra_managed_tenants')
        .where({ tenant: flagGate.tenantId })
        .whereIn('managed_tenant_id', managedTenantIds)
        .select(['managed_tenant_id', 'entra_tenant_id']);
    });

    const managedToEntraTenant = new Map<string, string>();
    for (const row of managedTenantRows) {
      const managedTenantId = String((row as { managed_tenant_id?: string }).managed_tenant_id || '');
      const entraTenantId = String((row as { entra_tenant_id?: string }).entra_tenant_id || '');
      if (managedTenantId && entraTenantId) {
        managedToEntraTenant.set(managedTenantId, entraTenantId);
      }
    }

    const activeConnection = await getActiveEntraPartnerConnection(flagGate.tenantId);
    if (!activeConnection) {
      return badRequest('No active Entra connection exists for this tenant.');
    }
    const provider = getEntraProviderAdapter(activeConnection.connection_type);
    const groupIdsByManagedTenant = new Map<string, Set<string>>();

    for (const mapping of mappingsWithEntitlementGroup) {
      const managedTenantId = String(mapping.managedTenantId || '').trim();
      if (!managedTenantId) {
        continue;
      }

      if (!groupIdsByManagedTenant.has(managedTenantId)) {
        const entraTenantId = managedToEntraTenant.get(managedTenantId);
        if (!entraTenantId) {
          return badRequest('Managed tenant was not found.');
        }
        const groups = await provider.listSecurityGroupsForTenant({
          tenant: flagGate.tenantId,
          managedTenantId: entraTenantId,
        });
        groupIdsByManagedTenant.set(
          managedTenantId,
          new Set(groups.map((group) => String(group.id)))
        );
      }

      const entitlementGroupId = String(mapping.clientPortalEntitlementGroupId || '').trim();
      if (!groupIdsByManagedTenant.get(managedTenantId)?.has(entitlementGroupId)) {
        return badRequest('Selected entitlement group must belong to the managed Entra tenant.');
      }
    }
  }

  const result = await confirmEntraMappings({
    tenant: flagGate.tenantId,
    userId: flagGate.userId,
    mappings: normalizedMappings,
  });

  return ok(result);
}
