/*
 * Deployment-safe permission catalog. Do not read source files here: this module
 * is loaded by migrations in packaged installations where the repository is absent.
 */
const PERMISSIONS = [
  ['asset','create'],['asset','read'],['asset','update'],['asset','delete'],
  ['billing','create'],['billing','read'],['billing','update'],['billing','delete'],
  ['client','create'],['client','read'],['client','update'],['client','delete'],
  ['contact','create'],['contact','read'],['contact','update'],['contact','delete'],
  ['document','create'],['document','read'],['document','update'],['document','delete'],
  ['email','process'],['job','delete'],['priority','create'],['quotes','approve'],
  ['secrets','view'],['secrets','manage'],['secrets','use'],
  ['ticket','create'],['ticket','read'],['ticket','update'],['ticket','delete'],
  ['user','create'],['user','read'],['user','update'],['user','delete'],
  ['workflow','read'],['workflow','view'],['workflow','manage'],['workflow','publish'],['workflow','admin'],
].map(([resource, action]) => ({ resource, action, msp: true, client: false, description: `${action} ${resource}` }));
const ROLE_GRANTS = { psa: { Admin: '*', Editor: ['secrets.view', 'secrets.use'] }, algadesk: { Admin: '*' } };
const RETIRED = ['client_documents.read', 'credit.reconcile'];
async function reconcileTenantPermissions(knex, tenant, productCode = 'psa') {
  const current = await knex('permissions').where({ tenant }).select('permission_id', 'resource', 'action', 'msp', 'client');
  const currentKeys = new Set(current.map((p) => `${p.resource}.${p.action}.${p.msp}.${p.client}`));
  const missing = PERMISSIONS.filter((p) => !currentKeys.has(`${p.resource}.${p.action}.${p.msp}.${p.client}`)).map((p) => ({ tenant, permission_id: knex.raw('gen_random_uuid()'), ...p, created_at: new Date() }));
  if (missing.length) await knex('permissions').insert(missing);
  for (const pair of RETIRED) { const [resource, action] = pair.split('.'); const rows = await knex('permissions').where({ tenant, resource, action }).select('permission_id'); if (rows.length) await knex('role_permissions').where({ tenant }).whereIn('permission_id', rows.map((r) => r.permission_id)).delete(); await knex('permissions').where({ tenant, resource, action }).delete(); }
  const grants = ROLE_GRANTS[productCode] || ROLE_GRANTS.psa; const roles = await knex('roles').where({ tenant, msp: true }).select('role_id', 'role_name'); const permissions = await knex('permissions').where({ tenant }).select('permission_id', 'resource', 'action', 'msp');
  for (const role of roles) { const allowed = grants[role.role_name]; const ids = allowed === '*' ? permissions.filter((p) => p.msp).map((p) => p.permission_id) : Array.isArray(allowed) ? permissions.filter((p) => allowed.includes(`${p.resource}.${p.action}`)).map((p) => p.permission_id) : []; for (const permission_id of ids) if (!await knex('role_permissions').where({ tenant, role_id: role.role_id, permission_id }).first()) await knex('role_permissions').insert({ tenant, role_id: role.role_id, permission_id }); }
}
async function reconcileAllTenants(knex) { for (const row of await knex('tenants').select('tenant', 'product_code')) await reconcileTenantPermissions(knex, row.tenant, row.product_code || 'psa'); }
module.exports = { PERMISSIONS, ROLE_GRANTS, RETIRED, reconcileTenantPermissions, reconcileAllTenants };
