import { badRequest, dynamic, ok, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';
import { getActiveEntraPartnerConnection } from '@enterprise/lib/integrations/entra/connectionRepository';
import { getEntraProviderAdapter } from '@enterprise/lib/integrations/entra/providers';

export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('read');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const { searchParams } = new URL(request.url);
  const managedTenantId = String(searchParams.get('managedTenantId') || '').trim();
  if (!managedTenantId) {
    return badRequest('managedTenantId is required.');
  }

  const managedTenant = await runWithTenant(flagGate.tenantId, async () => {
    const { knex } = await createTenantKnex();
    return knex('entra_managed_tenants')
      .where({
        tenant: flagGate.tenantId,
        managed_tenant_id: managedTenantId,
      })
      .first(['entra_tenant_id']);
  });

  if (!managedTenant?.entra_tenant_id) {
    return badRequest('Managed tenant was not found.');
  }

  const activeConnection = await getActiveEntraPartnerConnection(flagGate.tenantId);
  if (!activeConnection) {
    return badRequest('No active Entra connection exists for this tenant.');
  }

  const provider = getEntraProviderAdapter(activeConnection.connection_type);
  const groups = await provider.listSecurityGroupsForTenant({
    tenant: flagGate.tenantId,
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

