import { badRequest, dynamic, ok, parseJsonBody, runtime } from '../_responses';
import { requireEntraAccess } from '../_guards';
import { createTenantKnex, runWithTenant } from '@ee/lib/db';
import { tenantDb } from '@alga-psa/db';
import { parseEntraUserFilterConfig, validateEntraUserFilterConfig } from '@ee/lib/integrations/entra/sync/userFilterConfig';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  const access = await requireEntraAccess('read');
  if (access instanceof Response) return access;
  const config = await runWithTenant(access.tenantId, async () => {
    const { knex } = await createTenantKnex();
    const row = await tenantDb(knex, access.tenantId).table('entra_sync_settings').where({ tenant: access.tenantId }).first(['user_filter_config']);
    return parseEntraUserFilterConfig(row?.user_filter_config);
  });
  return ok({ config });
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireEntraAccess('update');
  if (access instanceof Response) return access;
  const body = await parseJsonBody(request);
  const validation = validateEntraUserFilterConfig(body.config);
  if (!validation.config) return badRequest(validation.error || 'Invalid filter configuration.');
  const now = new Date().toISOString();
  await runWithTenant(access.tenantId, async () => {
    const { knex } = await createTenantKnex();
    await tenantDb(knex, access.tenantId).table('entra_sync_settings').insert({ tenant: access.tenantId, user_filter_config: knex.raw('?::jsonb', [JSON.stringify(validation.config)]), updated_at: now }).onConflict('tenant').merge({ user_filter_config: knex.raw('?::jsonb', [JSON.stringify(validation.config)]), updated_at: now });
  });
  return ok({ config: validation.config });
}
