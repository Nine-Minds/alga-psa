import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../../_responses';
import { requireEntraAccess } from '../../_guards';
import { createTenantKnex, runWithTenant } from '@enterprise/lib/db';
import { tenantDb } from '@alga-psa/db';
import { parseEntraUserFilterConfig, parseEntraUserFilterOverride, mergeEntraUserFilterConfig, validateEntraUserFilterConfig } from '@enterprise/lib/integrations/entra/sync/userFilterConfig';
export { dynamic, runtime };

export async function GET(request: Request): Promise<Response> {
  const access = await requireEntraAccess('read');
  if (access instanceof Response) return access;
  const managedTenantId = new URL(request.url).searchParams.get('managedTenantId')?.trim();
  if (!managedTenantId) return badRequest('managedTenantId is required.');
  const data = await runWithTenant(access.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, access.tenantId);
    const exists = await db.table('entra_managed_tenants').where({ tenant: access.tenantId, managed_tenant_id: managedTenantId }).first('managed_tenant_id');
    if (!exists) return null;
    const [settings, row] = await Promise.all([db.table('entra_sync_settings').where({ tenant: access.tenantId }).first('user_filter_config'), db.table('entra_managed_tenant_user_filters').where({ tenant: access.tenantId, managed_tenant_id: managedTenantId }).first('filter_config')]);
    const override = row ? parseEntraUserFilterOverride(row.filter_config) : null;
    return { override, effective: mergeEntraUserFilterConfig(parseEntraUserFilterConfig(settings?.user_filter_config), override) };
  });
  return data ? ok(data) : badRequest('Managed tenant was not found.');
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireEntraAccess('update');
  if (access instanceof Response) return access;
  const body = await parseJsonBody(request);
  const managedTenantId = typeof body.managedTenantId === 'string' ? body.managedTenantId.trim() : '';
  if (!managedTenantId) return badRequest('managedTenantId is required.');
  const validation = body.override === null ? null : validateEntraUserFilterConfig(body.override);
  if (validation && !validation.config) return badRequest(validation.error || 'Invalid filter configuration.');
  const result = await runWithTenant(access.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, access.tenantId);
    const exists = await db.table('entra_managed_tenants').where({ tenant: access.tenantId, managed_tenant_id: managedTenantId }).first('managed_tenant_id');
    if (!exists) return null;
    if (body.override === null) await db.table('entra_managed_tenant_user_filters').where({ tenant: access.tenantId, managed_tenant_id: managedTenantId }).del();
    else {
      const override = parseEntraUserFilterOverride(body.override);
      await db.table('entra_managed_tenant_user_filters').insert({ tenant: access.tenantId, managed_tenant_id: managedTenantId, filter_config: knex.raw('?::jsonb', [JSON.stringify(override)]), updated_by: access.userId, updated_at: knex.fn.now() }).onConflict(['tenant', 'managed_tenant_id']).merge({ filter_config: knex.raw('?::jsonb', [JSON.stringify(override)]), updated_by: access.userId, updated_at: knex.fn.now() });
    }
    const [settings, row] = await Promise.all([db.table('entra_sync_settings').where({ tenant: access.tenantId }).first('user_filter_config'), db.table('entra_managed_tenant_user_filters').where({ tenant: access.tenantId, managed_tenant_id: managedTenantId }).first('filter_config')]);
    const override = row ? parseEntraUserFilterOverride(row.filter_config) : null;
    return { override, effective: mergeEntraUserFilterConfig(parseEntraUserFilterConfig(settings?.user_filter_config), override) };
  });
  return result ? ok(result) : badRequest('Managed tenant was not found.');
}
