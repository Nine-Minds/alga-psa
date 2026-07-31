import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';
import { tenantDb } from '@alga-psa/db';
import { getActiveEntraPartnerConnection } from '@enterprise/lib/integrations/entra/connectionRepository';
import { getEntraProviderAdapter } from '@enterprise/lib/integrations/entra/providers';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('read');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const { searchParams } = new URL(request.url);
  const managedTenantId = String(searchParams.get('managedTenantId') || '').trim();
  if (!managedTenantId) {
    return badRequest('managedTenantId is required.');
  }

  const managedTenant = await runWithTenant(accessGate.tenantId, async () => {
    const { knex } = await createTenantKnex();
    return tenantDb(knex, accessGate.tenantId).table('entra_managed_tenants')
      .where({ managed_tenant_id: managedTenantId })
      .first(['entra_tenant_id']);
  });

  if (!managedTenant?.entra_tenant_id) {
    return badRequest('Managed tenant was not found.');
  }

  const activeConnection = await getActiveEntraPartnerConnection(accessGate.tenantId);
  if (!activeConnection) {
    return badRequest('No active Entra connection exists for this tenant.');
  }

  const provider = getEntraProviderAdapter(activeConnection.connection_type);
  const groups = await provider.listSecurityGroupsForTenant({
    tenant: accessGate.tenantId,
    managedTenantId: String(managedTenant.entra_tenant_id),
  });

  return ok({
    groups: groups
      .map((group) => ({
        id: group.id,
        displayName: group.displayName || null,
      }))
      .sort((a, b) => (a.displayName || a.id).localeCompare(b.displayName || b.id)),
  });
}

