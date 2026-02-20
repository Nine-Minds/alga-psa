import logger from '@alga-psa/core/logger';
import { createTenantKnex, runWithTenant } from '@alga-psa/db/tenant';
import type { LoadMappedTenantsActivityInput, LoadMappedTenantsActivityOutput } from '../types/entra-sync';

export async function loadMappedTenantsActivity(
  input: LoadMappedTenantsActivityInput
): Promise<LoadMappedTenantsActivityOutput> {
  logger.info('Running loadMappedTenantsActivity', {
    tenantId: input.tenantId,
    managedTenantId: input.managedTenantId,
  });

  const mappings = await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const query = knex('entra_client_tenant_mappings as m')
      .join('entra_managed_tenants as t', function joinManagedTenants() {
        this.on('m.tenant', '=', 't.tenant').andOn(
          'm.managed_tenant_id',
          '=',
          't.managed_tenant_id'
        );
      })
      .where({
        'm.tenant': input.tenantId,
        'm.is_active': true,
        'm.mapping_state': 'mapped',
      })
      .select('m.managed_tenant_id', 'm.client_id', 't.entra_tenant_id')
      .orderBy('m.updated_at', 'asc');

    if (input.managedTenantId) {
      query.andWhere('m.managed_tenant_id', input.managedTenantId);
    }

    return query;
  });

  return {
    mappings: mappings.map((row: any) => ({
      managedTenantId: String(row.managed_tenant_id),
      entraTenantId: String(row.entra_tenant_id),
      clientId: row.client_id ? String(row.client_id) : null,
    })),
  };
}
