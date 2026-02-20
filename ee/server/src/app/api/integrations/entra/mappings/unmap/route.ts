import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraUiFlagEnabled } from '../../_guards';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const flagGate = await requireEntraUiFlagEnabled('update');
  if (flagGate instanceof Response) {
    return flagGate;
  }

  const body = await parseJsonBody(request);
  const managedTenantId = typeof body.managedTenantId === 'string' ? body.managedTenantId.trim() : '';

  if (!managedTenantId) {
    return badRequest('managedTenantId is required.');
  }

  await runWithTenant(flagGate.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const now = knex.fn.now();

    const activeMapping = await knex('entra_client_tenant_mappings')
      .where({
        tenant: flagGate.tenantId,
        managed_tenant_id: managedTenantId,
        is_active: true,
      })
      .first(['mapping_id', 'client_id']);

    if (!activeMapping) {
      return;
    }

    await knex('entra_client_tenant_mappings')
      .where({
        tenant: flagGate.tenantId,
        managed_tenant_id: managedTenantId,
        is_active: true,
      })
      .update({
        is_active: false,
        updated_at: now,
      });

    await knex('entra_client_tenant_mappings').insert({
      tenant: flagGate.tenantId,
      managed_tenant_id: managedTenantId,
      client_id: null,
      mapping_state: 'unmapped',
      confidence_score: null,
      is_active: true,
      decided_by: flagGate.userId,
      decided_at: now,
      created_at: now,
      updated_at: now,
    });

    if (activeMapping.client_id) {
      await knex('clients')
        .where({
          tenant: flagGate.tenantId,
          client_id: activeMapping.client_id,
        })
        .update({
          entra_tenant_id: null,
          entra_primary_domain: null,
          updated_at: now,
        });
    }
  });

  return ok({
    managedTenantId,
    status: 'unmapped',
  });
}
