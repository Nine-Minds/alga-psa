import { dynamic, ok, runtime } from './_responses';
import { requireEntraUiFlagEnabled } from './_guards';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { getActiveEntraPartnerConnection } from '@/lib/integrations/entra/connectionRepository';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled();
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const connection = await getActiveEntraPartnerConnection(flagGate.tenantId);

  const summary = await runWithTenant(flagGate.tenantId, async () => {
    const { knex } = await createTenantKnex();

    const [mappingCountRow, lastDiscoveryRow] = await Promise.all([
      knex('entra_client_tenant_mappings')
        .where({ tenant: flagGate.tenantId, is_active: true, mapping_state: 'mapped' })
        .count<{ count: string }>('* as count')
        .first(),
      knex('entra_managed_tenants')
        .where({ tenant: flagGate.tenantId })
        .max<{ last_discovered_at: string | null }>('discovered_at as last_discovered_at')
        .first(),
    ]);

    return {
      mappedTenantCount: Number(mappingCountRow?.count || 0),
      lastDiscoveryAt: lastDiscoveryRow?.last_discovered_at || null,
    };
  });

  return ok({
    status: connection?.status || 'not_connected',
    connectionType: connection?.connection_type || null,
    lastDiscoveryAt: summary.lastDiscoveryAt,
    mappedTenantCount: summary.mappedTenantCount,
    availableConnectionTypes: ['direct', 'cipp'],
    lastValidatedAt: connection?.last_validated_at || null,
    lastValidationError:
      connection && connection.last_validation_error && Object.keys(connection.last_validation_error).length > 0
        ? connection.last_validation_error
        : null,
  });
}
