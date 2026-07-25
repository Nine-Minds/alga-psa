import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';
import { tenantDb } from '@alga-psa/db';

export { dynamic, runtime };

export async function POST(request: Request): Promise<Response> {
  const accessGate = await requireEntraAccess('update');
  if (accessGate instanceof Response) {
    return accessGate;
  }

  const body = await parseJsonBody(request);
  const managedTenantId = typeof body.managedTenantId === 'string' ? body.managedTenantId.trim() : '';

  if (!managedTenantId) {
    return badRequest('managedTenantId is required.');
  }

  await runWithTenant(accessGate.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, accessGate.tenantId);
    const now = knex.fn.now();

    const activeMapping = await db.table('entra_client_tenant_mappings')
      .where({
        managed_tenant_id: managedTenantId,
        is_active: true,
      })
      .first(['mapping_id', 'client_id']);

    if (!activeMapping) {
      return;
    }

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
      tenant: accessGate.tenantId,
      managed_tenant_id: managedTenantId,
      client_id: null,
      mapping_state: 'unmapped',
      confidence_score: null,
      is_active: true,
      decided_by: accessGate.userId,
      decided_at: now,
      created_at: now,
      updated_at: now,
    });

    if (activeMapping.client_id) {
      await db.table('clients')
        .where({
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
