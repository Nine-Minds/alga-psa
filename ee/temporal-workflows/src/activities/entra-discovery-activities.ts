import logger from '@alga-psa/core/logger';
import { createTenantKnex, runWithTenant } from '@alga-psa/db/tenant';
import { getEntraProviderAdapter } from '@ee/lib/integrations/entra/providers';
import type { EntraConnectionType } from '@ee/interfaces/entra.interfaces';

export async function discoverManagedTenantsActivity(input: {
  tenantId: string;
}): Promise<{ discoveredTenantCount: number }> {
  logger.info('Running discoverManagedTenantsActivity', {
    tenantId: input.tenantId,
  });

  const activeConnection = await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    return knex('entra_partner_connections')
      .where({
        tenant: input.tenantId,
        is_active: true,
      })
      .orderBy('updated_at', 'desc')
      .first(['connection_type']);
  });

  if (!activeConnection?.connection_type) {
    throw new Error('No active Entra connection exists for this tenant.');
  }

  const adapter = getEntraProviderAdapter(
    activeConnection.connection_type as EntraConnectionType
  );
  const discovered = await adapter.listManagedTenants({ tenant: input.tenantId });

  if (discovered.length === 0) {
    return { discoveredTenantCount: 0 };
  }

  await runWithTenant(input.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();

    await knex('entra_managed_tenants')
      .insert(
        discovered.map((item) => ({
          tenant: input.tenantId,
          entra_tenant_id: item.entraTenantId,
          display_name: item.displayName,
          primary_domain: item.primaryDomain,
          source_user_count: item.sourceUserCount,
          discovered_at: now,
          last_seen_at: now,
          metadata: item.raw || {},
          created_at: now,
          updated_at: now,
        }))
      )
      .onConflict(['tenant', 'entra_tenant_id'])
      .merge({
        display_name: knex.raw('EXCLUDED.display_name'),
        primary_domain: knex.raw('EXCLUDED.primary_domain'),
        source_user_count: knex.raw('EXCLUDED.source_user_count'),
        metadata: knex.raw('EXCLUDED.metadata'),
        last_seen_at: now,
        updated_at: now,
      });
  });

  logger.info('Completed discoverManagedTenantsActivity', {
    tenantId: input.tenantId,
    discoveredTenantCount: discovered.length,
  });

  return {
    discoveredTenantCount: discovered.length,
  };
}
