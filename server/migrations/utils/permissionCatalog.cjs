/** Additive permission reconciliation. Keep this CommonJS for migration use. */
const PERMISSIONS = [
  ['secrets', 'view', 'View secret names and metadata (not values)'],
  ['secrets', 'manage', 'Create, update, and delete secrets'],
  ['email', 'process', 'Process outbound email'],
  ['job', 'delete', 'Clear job monitoring history'],
  ['priority', 'create', 'Create priorities'],
  ['quotes', 'approve', 'Approve quotes'],
].map(([resource, action, description]) => ({ resource, action, msp: true, client: false, description }));

const ROLE_GRANTS = { psa: { Admin: PERMISSIONS.map((p) => `${p.resource}.${p.action}`) }, algadesk: { Admin: PERMISSIONS.map((p) => `${p.resource}.${p.action}`) } };
const RETIRED = ['client_documents.read', 'credit.reconcile'];

async function reconcileTenantPermissions(knex, tenant, productCode = 'psa') {
  for (const p of PERMISSIONS) {
    const exists = await knex('permissions').where({ tenant, resource: p.resource, action: p.action, msp: p.msp, client: p.client }).first('permission_id');
    if (!exists) await knex('permissions').insert({ tenant, permission_id: knex.raw('gen_random_uuid()'), ...p, created_at: new Date() });
  }
  for (const pair of RETIRED) {
    const [resource, action] = pair.split('.');
    const rows = await knex('permissions').where({ tenant, resource, action }).select('permission_id');
    if (rows.length) await knex('role_permissions').where({ tenant }).whereIn('permission_id', rows.map((r) => r.permission_id)).delete();
    await knex('permissions').where({ tenant, resource, action }).delete();
  }
  const grants = ROLE_GRANTS[productCode] || ROLE_GRANTS.psa;
  for (const [roleName, pairs] of Object.entries(grants)) {
    const role = await knex('roles').where({ tenant, role_name: roleName, msp: true }).first('role_id');
    if (!role) continue;
    for (const pair of pairs) {
      const [resource, action] = pair.split('.');
      const permission = await knex('permissions').where({ tenant, resource, action }).first('permission_id');
      if (!permission) continue;
      const present = await knex('role_permissions').where({ tenant, role_id: role.role_id, permission_id: permission.permission_id }).first();
      if (!present) await knex('role_permissions').insert({ tenant, role_id: role.role_id, permission_id: permission.permission_id });
    }
  }
}
async function reconcileAllTenants(knex) {
  const tenants = await knex('tenants').select('tenant', 'product_code');
  for (const row of tenants) await reconcileTenantPermissions(knex, row.tenant, row.product_code || 'psa');
}
module.exports = { PERMISSIONS, ROLE_GRANTS, RETIRED, reconcileTenantPermissions, reconcileAllTenants };
