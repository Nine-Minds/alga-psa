const MIGRATION_TENANT = 'migration:20251221174000_add_workflow_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for workflow permission creation';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  const newPermissions = [
    { resource: 'workflow', action: 'read' },
    { resource: 'workflow', action: 'view' },
    { resource: 'workflow', action: 'manage' },
    { resource: 'workflow', action: 'publish' },
    { resource: 'workflow', action: 'admin' }
  ];

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const existingPerms = await db.table('permissions')
      .where({ tenant })
      .select('resource', 'action');

    const existingMap = new Set(existingPerms.map((p) => `${p.resource}:${p.action}`));

    const permissionsToAdd = newPermissions
      .filter((p) => !existingMap.has(`${p.resource}:${p.action}`))
      .map((p) => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        ...p,
        created_at: new Date()
    }));

    if (permissionsToAdd.length > 0) {
      await db.table('permissions').insert(permissionsToAdd);
    }

    const roles = await db.table('roles').where({ tenant });
    const adminRole = roles.find((role) => role.role_name && role.role_name.toLowerCase() === 'admin');
    if (adminRole) {
      const newPermIds = await db.table('permissions')
        .where({ tenant })
        .where((builder) => {
          builder.where('resource', 'workflow').whereIn('action', ['read', 'view', 'manage', 'publish', 'admin']);
        })
        .select('permission_id');

      const existingRolePerms = await db.table('role_permissions')
        .where({ tenant, role_id: adminRole.role_id })
        .select('permission_id');

      const existingRolePermIds = new Set(existingRolePerms.map((rp) => rp.permission_id));
      const rolePermissionsToAdd = newPermIds
        .filter((perm) => !existingRolePermIds.has(perm.permission_id))
        .map((perm) => ({
          tenant,
          role_id: adminRole.role_id,
          permission_id: perm.permission_id
      }));

      if (rolePermissionsToAdd.length > 0) {
        await db.table('role_permissions').insert(rolePermissionsToAdd);
      }
    }
  }
};

exports.down = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const perms = await db.table('permissions')
      .where({ tenant })
      .where('resource', 'workflow')
      .whereIn('action', ['read', 'view', 'manage', 'publish', 'admin'])
      .select('permission_id');

    const permIds = perms.map((perm) => perm.permission_id);
    if (permIds.length) {
      await db.table('role_permissions')
        .where({ tenant })
        .whereIn('permission_id', permIds)
        .del();
      await db.table('permissions')
        .where({ tenant })
        .whereIn('permission_id', permIds)
        .del();
    }
  }
};
