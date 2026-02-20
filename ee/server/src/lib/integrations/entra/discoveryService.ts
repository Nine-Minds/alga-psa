import { createTenantKnex, runWithTenant } from '@/lib/db';
import { getActiveEntraPartnerConnection } from './connectionRepository';
import { mapEntraManagedTenantRow } from './entraRowMappers';
import { getEntraProviderAdapter } from './providers';

export interface EntraDiscoveredTenantResult {
  managedTenantId: string;
  entraTenantId: string;
  displayName: string | null;
  primaryDomain: string | null;
  sourceUserCount: number;
  discoveredAt: string;
  lastSeenAt: string;
}

export interface EntraDiscoveryServiceResult {
  discoveredTenantCount: number;
  discoveredTenants: EntraDiscoveredTenantResult[];
}

export async function discoverManagedTenantsForTenant(
  tenant: string
): Promise<EntraDiscoveryServiceResult> {
  const activeConnection = await getActiveEntraPartnerConnection(tenant);
  if (!activeConnection) {
    throw new Error('No active Entra connection exists for this tenant.');
  }

  const provider = getEntraProviderAdapter(activeConnection.connection_type);
  const discovered = await provider.listManagedTenants({ tenant });

  if (discovered.length === 0) {
    return {
      discoveredTenantCount: 0,
      discoveredTenants: [],
    };
  }

  const discoveredTenantIds = discovered.map((item) => item.entraTenantId);

  const persistedRows = await runWithTenant(tenant, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();

    const insertRows = discovered.map((item) => ({
      tenant,
      entra_tenant_id: item.entraTenantId,
      display_name: item.displayName,
      primary_domain: item.primaryDomain,
      source_user_count: item.sourceUserCount,
      discovered_at: now,
      last_seen_at: now,
      metadata: item.raw || {},
      created_at: now,
      updated_at: now,
    }));

    await knex('entra_managed_tenants')
      .insert(insertRows)
      .onConflict(['tenant', 'entra_tenant_id'])
      .merge({
        display_name: knex.raw('EXCLUDED.display_name'),
        primary_domain: knex.raw('EXCLUDED.primary_domain'),
        source_user_count: knex.raw('EXCLUDED.source_user_count'),
        metadata: knex.raw('EXCLUDED.metadata'),
        last_seen_at: now,
        updated_at: now,
      });

    return knex('entra_managed_tenants')
      .where({ tenant })
      .whereIn('entra_tenant_id', discoveredTenantIds)
      .orderBy('display_name', 'asc')
      .select('*');
  });

  const discoveredTenants = persistedRows.map((row) => {
    const mapped = mapEntraManagedTenantRow(row as Record<string, unknown>);
    return {
      managedTenantId: mapped.managed_tenant_id,
      entraTenantId: mapped.entra_tenant_id,
      displayName: mapped.display_name,
      primaryDomain: mapped.primary_domain,
      sourceUserCount: mapped.source_user_count,
      discoveredAt: mapped.discovered_at,
      lastSeenAt: mapped.last_seen_at,
    };
  });

  return {
    discoveredTenantCount: discoveredTenants.length,
    discoveredTenants,
  };
}
