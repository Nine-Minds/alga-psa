/* Mechanical union of permission seeds and permission migrations. */
const fs = require('fs');
const path = require('path');
const { ALL_MSP, psa } = require('../../../ee/server/seeds/onboarding/lib/roleGrants.cjs');
const ROOT = path.resolve(__dirname, '../../..');
function objectsFrom(source) {
  const entries = []; const re = /\{\s*resource:\s*['"]([^'"]+)['"]\s*,\s*action:\s*['"]([^'"]+)['"]([^}]*)\}/g;
  for (const m of source.matchAll(re)) entries.push({ resource: m[1], action: m[2], msp: !/msp:\s*false/.test(m[3]), client: /client:\s*true/.test(m[3]), description: `${m[2]} ${m[1]}` });
  return entries;
}
const sourceFiles = [
  'ee/server/seeds/onboarding/psa/02_permissions.cjs', 'ee/server/seeds/onboarding/algadesk/02_permissions.cjs', 'server/seeds/dev/47_permissions.cjs',
  ...fs.readdirSync(path.join(ROOT, 'server/migrations')).filter((f) => f.includes('permission') && f.endsWith('.cjs')).map((f) => `server/migrations/${f}`),
];
const catalog = new Map();
for (const file of sourceFiles) for (const p of objectsFrom(fs.readFileSync(path.join(ROOT, file), 'utf8'))) catalog.set(`${p.resource}.${p.action}.${p.msp}.${p.client}`, p);
for (const action of ['view', 'manage', 'use']) catalog.set(`secrets.${action}.true.false`, { resource: 'secrets', action, msp: true, client: false, description: `${action} secrets` });
const PERMISSIONS = [...catalog.values()];
const ROLE_GRANTS = { psa: { msp: psa.msp, client: psa.client }, algadesk: { msp: { Admin: ALL_MSP, Agent: ['client.read', 'contact.read', 'document.create', 'document.read', 'document.update', 'profile.read', 'profile.update', 'reports.read', 'tag.create', 'tag.read', 'tag.update', 'ticket.create', 'ticket.read', 'ticket.update', 'ticket_settings.read', 'user.read', 'user_settings.read'] }, client: {} } };
const RETIRED = ['client_documents.read', 'credit.reconcile'];
const permissionKey = (p) => `${p.resource}:${p.action}:${p.msp ? 'msp' : 'client'}`;
async function reconcileTenantPermissions(knex, tenant, productCode = 'psa') {
  const old = await knex('permissions').where({ tenant }).select('permission_id', 'resource', 'action', 'msp', 'client'); const have = new Set(old.map(permissionKey));
  const additions = PERMISSIONS.filter((p) => !have.has(permissionKey(p))).map((p) => ({ tenant, permission_id: knex.raw('gen_random_uuid()'), ...p, created_at: new Date() })); if (additions.length) await knex('permissions').insert(additions);
  for (const pair of RETIRED) { const [resource, action] = pair.split('.'); const rows = await knex('permissions').where({ tenant, resource, action }).select('permission_id'); if (rows.length) await knex('role_permissions').where({ tenant }).whereIn('permission_id', rows.map((x) => x.permission_id)).delete(); await knex('permissions').where({ tenant, resource, action }).delete(); }
  const roles = await knex('roles').where({ tenant }).select('role_id', 'role_name', 'msp', 'client'); const permissions = await knex('permissions').where({ tenant }).select('permission_id', 'resource', 'action', 'msp', 'client'); const ids = new Map(permissions.map((p) => [permissionKey(p), p.permission_id])); const grants = ROLE_GRANTS[productCode] || ROLE_GRANTS.psa;
  for (const role of roles) { const roleGrants = role.msp ? grants.msp?.[role.role_name] : grants.client?.[role.role_name]; let selected = roleGrants === ALL_MSP ? permissions.filter((p) => p.msp).map((p) => p.permission_id) : Array.isArray(roleGrants) ? roleGrants.map((x) => { const [resource, action] = x.split(/[.:]/); return ids.get(`${resource}:${action}:${role.msp ? 'msp' : 'client'}`); }).filter(Boolean) : []; if (productCode === 'psa' && role.msp && role.role_name === 'Editor') selected.push(ids.get('secrets:view:msp'), ids.get('secrets:use:msp')); for (const permission_id of new Set(selected.filter(Boolean))) if (!await knex('role_permissions').where({ tenant, role_id: role.role_id, permission_id }).first()) await knex('role_permissions').insert({ tenant, role_id: role.role_id, permission_id }); }
}
async function reconcileAllTenants(knex) { for (const t of await knex('tenants').select('tenant', 'product_code')) await reconcileTenantPermissions(knex, t.tenant, t.product_code || 'psa'); }
module.exports = { PERMISSIONS, ROLE_GRANTS, RETIRED, reconcileTenantPermissions, reconcileAllTenants };
