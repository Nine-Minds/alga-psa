const MIGRATION_TENANT = 'migration:20260320105000_add_quote_approval_permission';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for quote approval permission backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    let permission = await db.table('permissions')
      .where({ tenant, resource: 'quotes', action: 'approve' })
      .first(['permission_id', 'description', 'msp', 'client']);

    if (!permission) {
      const [inserted] = await db.table('permissions')
        .insert({
          tenant,
          resource: 'quotes',
          action: 'approve',
          msp: true,
          client: false,
          description: 'Approve or request changes to quotes pending internal approval',
        })
        .returning(['permission_id', 'description', 'msp', 'client']);
      permission = inserted;
    } else if (!permission.msp || permission.client || !permission.description) {
      await db.table('permissions')
        .where({ tenant, permission_id: permission.permission_id })
        .update({
          msp: true,
          client: false,
          description: permission.description || 'Approve or request changes to quotes pending internal approval',
          updated_at: knex.fn.now(),
        });
    }

    const adminRoles = await db.table('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', ['Admin'])
      .select('role_id');

    for (const role of adminRoles) {
      const existingRolePermission = await db.table('role_permissions')
        .where({ tenant, role_id: role.role_id, permission_id: permission.permission_id })
        .first('tenant');

      if (!existingRolePermission) {
        await db.table('role_permissions').insert({
          tenant,
          role_id: role.role_id,
          permission_id: permission.permission_id,
        });
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIds = await db.table('permissions')
      .where({ tenant, resource: 'quotes', action: 'approve' })
      .pluck('permission_id');

    if (permissionIds.length === 0) {
      continue;
    }

    await db.table('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await db.table('permissions')
      .where({ tenant, resource: 'quotes', action: 'approve' })
      .del();
  }
};
