/**
 * AlgaDesk tenants gain access to the Account Management page (subscription,
 * seats, and the self-serve AlgaDesk→AlgaPSA upgrade). The algadesk onboarding
 * seed now includes the account_management resource for new tenants
 * (ee/server/seeds/onboarding/algadesk/02_permissions.cjs); this backfills
 * existing algadesk tenants: permission rows + grants for the MSP Admin role.
 */
const { tenantDb } = require('./utils/tenantDb.cjs');

const PERMISSIONS = [
  { resource: 'account_management', action: 'read', msp: true, client: false, description: 'View account and subscription details' },
  { resource: 'account_management', action: 'update', msp: true, client: false, description: 'Manage account and subscription settings' },
  { resource: 'account_management', action: 'delete', msp: true, client: false, description: 'Cancel subscription and delete account' },
];

exports.up = async function up(knex) {
  const tenants = await tenantDb(knex, 'migration:add_account_management_to_algadesk')
    .unscoped('tenants', 'migration enumerates algadesk tenants to backfill account_management permissions')
    .where({ product_code: 'algadesk' })
    .select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);

    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true, client: false })
      .first('role_id');

    for (const perm of PERMISSIONS) {
      let row = await db.table('permissions')
        .where({ tenant, resource: perm.resource, action: perm.action, msp: perm.msp, client: perm.client })
        .first('permission_id');

      if (!row) {
        const inserted = await db.table('permissions')
          .insert({ tenant, ...perm })
          .returning('permission_id');
        row = inserted[0];
      }

      if (adminRole) {
        await db.table('role_permissions')
          .insert({ tenant, role_id: adminRole.role_id, permission_id: row.permission_id })
          .onConflict(['tenant', 'role_id', 'permission_id'])
          .ignore();
      }
    }
  }
};

exports.down = async function down(knex) {
  // Leave the permissions in place: removing grants from live tenants is the
  // destructive direction, and the rows are inert if the page is re-gated.
};
