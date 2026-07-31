import { createTenantKnex, runWithTenant } from '@/lib/db';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface ConfirmEntraMappingInput {
  managedTenantId: string;
  clientId?: string | null;
  mappingState?: 'mapped' | 'create_new' | 'skip_for_now' | 'needs_review';
  confidenceScore?: number | null;
  clientPortalEntraProvisioningMode?: 'inherit' | 'disabled' | 'built_in' | 'workflow_managed';
  clientPortalEntitlementGroupId?: string | null;
  clientPortalEntitlementMembershipMode?: 'transitive';
  clientPortalDefaultRoleName?: string | null;
  clientPortalWorkflowTarget?: string | null;
  clientPortalWorkflowConfig?: Record<string, unknown> | null;
}

export interface ConfirmEntraMappingsResult {
  confirmedMappings: number;
}

export interface ConfirmEntraMappingsParams {
  tenant: string;
  userId: string;
  mappings: ConfirmEntraMappingInput[];
}

function normalizeMappingState(
  input: ConfirmEntraMappingInput
): 'mapped' | 'create_new' | 'skip_for_now' | 'needs_review' {
  if (
    input.mappingState === 'mapped'
    || input.mappingState === 'create_new'
    || input.mappingState === 'skip_for_now'
    || input.mappingState === 'needs_review'
  ) {
    return input.mappingState;
  }
  if (input.clientId) {
    return 'mapped';
  }
  return 'skip_for_now';
}

function normalizeProvisioningMode(
  value: unknown,
  fallback: 'inherit' | 'disabled' | 'built_in' | 'workflow_managed' = 'inherit'
): 'inherit' | 'disabled' | 'built_in' | 'workflow_managed' {
  if (
    value === 'inherit' ||
    value === 'disabled' ||
    value === 'built_in' ||
    value === 'workflow_managed'
  ) {
    return value;
  }
  return fallback;
}

function normalizeEntitlementMembershipMode(): 'transitive' {
  return 'transitive';
}

export async function confirmEntraMappingsWithDb(
  knex: Knex | Knex.Transaction,
  params: ConfirmEntraMappingsParams
): Promise<ConfirmEntraMappingsResult> {
  if (params.mappings.length === 0) {
    return { confirmedMappings: 0 };
  }

  const now = knex.fn.now();
  let confirmedMappings = 0;

  await knex.transaction(async (trx) => {
      const db = tenantDb(trx, params.tenant);
      for (const mapping of params.mappings) {
        const managedTenantId = String(mapping.managedTenantId || '').trim();
        if (!managedTenantId) {
          continue;
        }

        const mappingState = normalizeMappingState(mapping);
        const requestedClientId = mapping.clientId ? String(mapping.clientId).trim() : null;
        if (mappingState === 'mapped' && !requestedClientId) {
          throw new Error('A mapped Entra tenant decision requires a client ID.');
        }
        const clientId = mappingState === 'mapped' ? requestedClientId : null;
        const confidenceScore =
          typeof mapping.confidenceScore === 'number' ? mapping.confidenceScore : null;

        const managedTenant = await db.table('entra_managed_tenants')
          .where({
            tenant: params.tenant,
            managed_tenant_id: managedTenantId,
          })
          .first(['entra_tenant_id', 'primary_domain']);

        if (!managedTenant) {
          continue;
        }

        const existingActive = await db.table('entra_client_tenant_mappings')
          .where({
            managed_tenant_id: managedTenantId,
            is_active: true,
          })
          .first([
            'mapping_id',
            'client_id',
            'mapping_state',
            'client_portal_entra_provisioning_mode',
            'client_portal_entitlement_group_id',
            'client_portal_entitlement_membership_mode',
            'client_portal_default_role_name',
            'client_portal_workflow_target',
            'client_portal_workflow_config',
          ]);

        const existingProvisioningMode = normalizeProvisioningMode(
          existingActive?.client_portal_entra_provisioning_mode
        );
        const clientPortalEntraProvisioningMode =
          mapping.clientPortalEntraProvisioningMode === undefined
            ? existingProvisioningMode
            : normalizeProvisioningMode(mapping.clientPortalEntraProvisioningMode);
        const clientPortalEntitlementGroupId =
          mapping.clientPortalEntitlementGroupId === undefined
            ? existingActive?.client_portal_entitlement_group_id
              ? String(existingActive.client_portal_entitlement_group_id)
              : null
            : mapping.clientPortalEntitlementGroupId
              ? String(mapping.clientPortalEntitlementGroupId).trim() || null
              : null;
        const clientPortalEntitlementMembershipMode =
          normalizeEntitlementMembershipMode();
        const clientPortalDefaultRoleName =
          mapping.clientPortalDefaultRoleName === undefined
            ? existingActive?.client_portal_default_role_name
              ? String(existingActive.client_portal_default_role_name)
              : null
            : mapping.clientPortalDefaultRoleName === null
              ? null
              : String(mapping.clientPortalDefaultRoleName || '').trim() || null;
        const clientPortalWorkflowTarget =
          mapping.clientPortalWorkflowTarget === undefined
            ? existingActive?.client_portal_workflow_target
              ? String(existingActive.client_portal_workflow_target)
              : null
            : mapping.clientPortalWorkflowTarget === null
              ? null
              : String(mapping.clientPortalWorkflowTarget || '').trim() || null;
        const existingWorkflowConfig =
          existingActive?.client_portal_workflow_config &&
          typeof existingActive.client_portal_workflow_config === 'object' &&
          !Array.isArray(existingActive.client_portal_workflow_config)
            ? existingActive.client_portal_workflow_config
            : null;
        const clientPortalWorkflowConfig =
          mapping.clientPortalWorkflowConfig === undefined
            ? existingWorkflowConfig
            : mapping.clientPortalWorkflowConfig &&
                typeof mapping.clientPortalWorkflowConfig === 'object' &&
                !Array.isArray(mapping.clientPortalWorkflowConfig)
              ? mapping.clientPortalWorkflowConfig
              : null;

        if (
          existingActive &&
          String(existingActive.client_id || '') === String(clientId || '') &&
          existingActive.mapping_state === mappingState
        ) {
          await db.table('entra_client_tenant_mappings')
            .where({ mapping_id: existingActive.mapping_id })
            .update({
              confidence_score: confidenceScore,
              client_portal_entra_provisioning_mode: clientPortalEntraProvisioningMode,
              client_portal_entitlement_group_id: clientPortalEntitlementGroupId,
              client_portal_entitlement_membership_mode:
                clientPortalEntitlementMembershipMode,
              client_portal_default_role_name: clientPortalDefaultRoleName,
              client_portal_workflow_target: clientPortalWorkflowTarget,
              client_portal_workflow_config: clientPortalWorkflowConfig,
              decided_by: params.userId,
              decided_at: now,
              updated_at: now,
            });
        } else {
          await db.table('entra_client_tenant_mappings')
            .where({
              managed_tenant_id: managedTenantId,
              is_active: true,
            })
            .update({
              is_active: false,
              updated_at: now,
            });

          await db.table('entra_client_tenant_mappings').insert({
            tenant: params.tenant,
            managed_tenant_id: managedTenantId,
            client_id: clientId,
            mapping_state: mappingState,
            confidence_score: confidenceScore,
            client_portal_entra_provisioning_mode: clientPortalEntraProvisioningMode,
            client_portal_entitlement_group_id: clientPortalEntitlementGroupId,
            client_portal_entitlement_membership_mode:
              clientPortalEntitlementMembershipMode,
            client_portal_default_role_name: clientPortalDefaultRoleName,
            client_portal_workflow_target: clientPortalWorkflowTarget,
            client_portal_workflow_config: clientPortalWorkflowConfig,
            is_active: true,
            decided_by: params.userId,
            decided_at: now,
            created_at: now,
            updated_at: now,
          });
        }

        if (mappingState === 'mapped' && clientId) {
          await db.table('clients')
            .where({
              client_id: clientId,
            })
            .update({
              entra_tenant_id: managedTenant.entra_tenant_id,
              entra_primary_domain: managedTenant.primary_domain || null,
              updated_at: now,
            });
        }

        confirmedMappings += 1;
      }
  });

  return { confirmedMappings };
}

export async function confirmEntraMappings(
  params: ConfirmEntraMappingsParams
): Promise<ConfirmEntraMappingsResult> {
  return runWithTenant(params.tenant, async () => {
    const { knex } = await createTenantKnex();
    return confirmEntraMappingsWithDb(knex, params);
  });
}
