/**
 * Add Account Management permission for MSP Admin roles
 * - Adds the account_management permissions (read, update, delete) for MSP only
 * - Assigns the permissions to the MSP Admin role per tenant
 */

const MIGRATION_TENANT = 'migration:20251014130000_add_account_management_permission';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for account management permission backfill';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).pluck('tenant');
  const actions = [
    { action: 'read', description: 'View account and subscription details' },
    { action: 'update', description: 'Manage account and subscription settings' },
    { action: 'delete', description: 'Cancel subscription and delete account' },
  ];

  for (const tenant of tenants) {
    const db = tenantDb(knex, tenant);
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const { action, description } of actions) {
      const permission = await db.table('permissions')
        .where({ tenant, resource: 'account_management', action })
        .first();

      let permissionId;

      if (permission) {
        permissionId = permission.permission_id;

        // Update to ensure it's MSP-only
        if (!permission.msp || permission.client || (!permission.description && description)) {
          await db.table('permissions')
            .where({ permission_id: permissionId })
            .update({
              msp: true,
              client: false,
              description: permission.description || description,
            });
        }
      } else {
        const [inserted] = await db.table('permissions')
          .insert({
            permission_id: knex.raw('gen_random_uuid()'),
            tenant,
            resource: 'account_management',
            action,
            msp: true,
            client: false,
            description,
            created_at: knex.fn.now(),
          })
          .returning(['permission_id']);

        permissionId = inserted.permission_id;
      }

      if (!permissionId || !adminRole) {
        continue;
      }

      const assignment = await db.table('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permissionId })
        .first();

      if (!assignment) {
        await db.table('role_permissions').insert({
          tenant,
          role_id: adminRole.role_id,
          permission_id: permissionId,
          created_at: knex.fn.now(),
        });
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).pluck('tenant');
  const actions = ['read', 'update', 'delete'];

  for (const tenant of tenants) {
    const db = tenantDb(knex, tenant);
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const action of actions) {
      const permission = await db.table('permissions')
        .where({ tenant, resource: 'account_management', action })
        .first();

      if (!permission) {
        continue;
      }

      if (adminRole) {
        await db.table('role_permissions')
          .where({ tenant, role_id: adminRole.role_id, permission_id: permission.permission_id })
          .delete();
      }

      await db.table('permissions')
        .where({ permission_id: permission.permission_id })
        .delete();
    }
  }
};
