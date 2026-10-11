const { roleGrants } = require('../lib/permissionCatalog.cjs');
const { forCoManagedTenants } = require('../lib/coManagedSeeds.cjs');

exports.seed = async function (knex, tenantId) {
  const { tenantDb } = await import('@alga-psa/db');
  await forCoManagedTenants(knex, tenantId, async (tenant) => {
    const db = tenantDb(knex, tenant);
    const existing = await db.table('roles');
    const missing = roleGrants.getDefaultRoles('co_managed').filter(role => !existing.some(row =>
      row.role_name === role.roleName && row.msp === role.msp && row.client === role.client));
    if (missing.length) await db.table('roles').insert(missing.map(role => ({ tenant,
      role_name: role.roleName, msp: role.msp, client: role.client,
      description: `${role.client ? 'Requester portal' : 'Co-managed IT'} ${role.roleName}`,
    })));
  });
};
