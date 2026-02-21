import { createTenantKnex, runWithTenant } from '@/lib/db';

export interface ConfirmEntraMappingInput {
  managedTenantId: string;
  clientId?: string | null;
  mappingState?: 'mapped' | 'skip_for_now' | 'needs_review';
  confidenceScore?: number | null;
}

export interface ConfirmEntraMappingsResult {
  confirmedMappings: number;
}

function normalizeMappingState(input: ConfirmEntraMappingInput): 'mapped' | 'skip_for_now' | 'needs_review' {
  if (input.mappingState === 'skip_for_now' || input.mappingState === 'needs_review') {
    return input.mappingState;
  }
  if (input.clientId) {
    return 'mapped';
  }
  return 'skip_for_now';
}

export async function confirmEntraMappings(
  params: {
    tenant: string;
    userId: string;
    mappings: ConfirmEntraMappingInput[];
  }
): Promise<ConfirmEntraMappingsResult> {
  if (params.mappings.length === 0) {
    return { confirmedMappings: 0 };
  }

  return runWithTenant(params.tenant, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();
    let confirmedMappings = 0;

    await knex.transaction(async (trx) => {
      for (const mapping of params.mappings) {
        const managedTenantId = String(mapping.managedTenantId || '').trim();
        if (!managedTenantId) {
          continue;
        }

        const clientId = mapping.clientId ? String(mapping.clientId).trim() : null;
        const mappingState = normalizeMappingState(mapping);
        const confidenceScore =
          typeof mapping.confidenceScore === 'number' ? mapping.confidenceScore : null;

        const managedTenant = await trx('entra_managed_tenants')
          .where({
            tenant: params.tenant,
            managed_tenant_id: managedTenantId,
          })
          .first(['entra_tenant_id', 'primary_domain']);

        if (!managedTenant) {
          continue;
        }

        const existingActive = await trx('entra_client_tenant_mappings')
          .where({
            tenant: params.tenant,
            managed_tenant_id: managedTenantId,
            is_active: true,
          })
          .first(['mapping_id', 'client_id', 'mapping_state']);

        if (
          existingActive &&
          String(existingActive.client_id || '') === String(clientId || '') &&
          existingActive.mapping_state === mappingState
        ) {
          await trx('entra_client_tenant_mappings')
            .where({ mapping_id: existingActive.mapping_id })
            .update({
              confidence_score: confidenceScore,
              decided_by: params.userId,
              decided_at: now,
              updated_at: now,
            });
        } else {
          await trx('entra_client_tenant_mappings')
            .where({
              tenant: params.tenant,
              managed_tenant_id: managedTenantId,
              is_active: true,
            })
            .update({
              is_active: false,
              updated_at: now,
            });

          await trx('entra_client_tenant_mappings').insert({
            tenant: params.tenant,
            managed_tenant_id: managedTenantId,
            client_id: clientId,
            mapping_state: mappingState,
            confidence_score: confidenceScore,
            is_active: true,
            decided_by: params.userId,
            decided_at: now,
            created_at: now,
            updated_at: now,
          });
        }

        if (mappingState === 'mapped' && clientId) {
          await trx('clients')
            .where({
              tenant: params.tenant,
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
  });
}
