/**
 * Ensure MSP Admin roles have full access to settings permissions after prior migrations.
 */

const MIGRATION_TENANT = 'migration:20250922113000_backfill_settings_permissions_all_actions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for settings permission action backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).pluck('tenant');
  const actions = [
    { action: 'read', description: 'View portal settings' },
    { action: 'create', description: 'Create portal settings' },
    { action: 'update', description: 'Manage portal settings' },
    { action: 'delete', description: 'Delete portal settings' },
  ];

  for (const tenant of tenants) {
    const db = tenantDb(knex, tenant);
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const { action, description } of actions) {
      const permission = await db.table('permissions')
        .where({ tenant, resource: 'settings', action })
        .first();

      let permissionId;

      if (permission) {
        permissionId = permission.permission_id;

        if (!permission.msp || !permission.client || (!permission.description && description)) {
          await db.table('permissions')
            .where({ permission_id: permissionId })
            .update({
              msp: true,
              client: true,
              description: permission.description || description,
            });
        }
      } else {
        const [inserted] = await db.table('permissions')
          .insert({
            permission_id: knex.raw('gen_random_uuid()'),
            tenant,
            resource: 'settings',
            action,
            msp: true,
            client: true,
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

  const dbUserServer = process.env.DB_USER_SERVER || 'app_user';
  await knex.schema.raw('GRANT ALL PRIVILEGES ON TABLE portal_domains TO ??', [dbUserServer]);
};

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).pluck('tenant');
  const actions = ['read', 'create', 'update', 'delete'];

  for (const tenant of tenants) {
    const db = tenantDb(knex, tenant);
    const adminRole = await db.table('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const action of actions) {
      const permission = await db.table('permissions')
        .where({ tenant, resource: 'settings', action })
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
        .update({ msp: false, client: true });
    }
  }
};
