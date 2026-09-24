import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';
import { tenantDb } from '@alga-psa/db';
import { parseEntraUserFilterConfig, parseEntraUserFilterOverride, mergeEntraUserFilterConfig, validateEntraUserFilterConfig } from '@enterprise/lib/integrations/entra/sync/userFilterConfig';

export { dynamic, runtime };
type Context = { params: Promise<{ managedTenantId: string }> };

async function read(access: { tenantId: string }, managedTenantId: string) {
  return runWithTenant(access.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, access.tenantId);
    const exists = await db.table('entra_managed_tenants').where({ tenant: access.tenantId, managed_tenant_id: managedTenantId }).first('managed_tenant_id');
    if (!exists) return null;
    const [settings, row] = await Promise.all([db.table('entra_sync_settings').where({ tenant: access.tenantId }).first('user_filter_config'), db.table('entra_managed_tenant_user_filters').where({ tenant: access.tenantId, managed_tenant_id: managedTenantId }).first('filter_config')]);
    const override = row ? parseEntraUserFilterOverride(row.filter_config) : null;
    return { override, effective: mergeEntraUserFilterConfig(parseEntraUserFilterConfig(settings?.user_filter_config), override) };
  });
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  const access = await requireEntraAccess('read');
  if (access instanceof Response) return access;
  const { managedTenantId } = await context.params;
  const data = await read(access, managedTenantId);
  return data ? ok(data) : badRequest('Managed tenant was not found.');
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await requireEntraAccess('update');
  if (access instanceof Response) return access;
  const { managedTenantId } = await context.params;
  const body = await parseJsonBody(request);
  const exists = await read(access, managedTenantId);
  if (!exists) return badRequest('Managed tenant was not found.');
  if (body.override === null) {
    await runWithTenant(access.tenantId, async () => { const { knex } = await createTenantKnex(); await tenantDb(knex, access.tenantId).table('entra_managed_tenant_user_filters').where({ tenant: access.tenantId, managed_tenant_id: managedTenantId }).del(); });
    return ok(await read(access, managedTenantId));
  }
  const validation = validateEntraUserFilterConfig(body.override);
  if (!validation.config) return badRequest(validation.error || 'Invalid filter configuration.');
  const override = parseEntraUserFilterOverride(body.override);
  await runWithTenant(access.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, access.tenantId);
    await db.table('entra_managed_tenant_user_filters').insert({ tenant: access.tenantId, managed_tenant_id: managedTenantId, filter_config: knex.raw('?::jsonb', [JSON.stringify(override)]), updated_by: access.userId, updated_at: knex.fn.now() }).onConflict(['tenant', 'managed_tenant_id']).merge({ filter_config: knex.raw('?::jsonb', [JSON.stringify(override)]), updated_by: access.userId, updated_at: knex.fn.now() });
  });
  return ok(await read(access, managedTenantId));
}
