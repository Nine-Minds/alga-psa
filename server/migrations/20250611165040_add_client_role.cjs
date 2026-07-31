const MIGRATION_TENANT = 'migration:20250611165040_add_client_role';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for client role backfill';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  // Get all tenants
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  // For each tenant, add the roles if they don't exist
  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    // --- Role Definitions ---
    const rolesToCreate = [
      { role_name: 'Client', description: 'Client user role' },
      { role_name: 'Client_Admin', description: 'Client administrator role' },
      { role_name: 'Dispatcher', description: 'Role for users who can dispatch and schedule for other users' }
    ];

    for (const role of rolesToCreate) {
      const existingRole = await db.table('roles')
        .where({ tenant })
        .whereRaw('LOWER(role_name) = ?', [role.role_name.toLowerCase()])
        .first();
      
      if (!existingRole) {
        await db.table('roles').insert({
          tenant,
          role_id: knex.raw('gen_random_uuid()'),
          ...role
        });
      }
    }

    // --- Permission Definitions ---
    const getPermissions = async (permissionMap) => {
      const permissions = await db.table('permissions')
        .where({ tenant })
        .where(function() {
          for (const resource in permissionMap) {
            this.orWhere(function() {
              this.where('resource', resource).whereIn('action', permissionMap[resource]);
            });
          }
        });
      return permissions;
    };

    const clientPermissionMap = {
      'project': ['read'],
      'profile': ['read', 'update'],
      'asset': ['read'],
      'ticket': ['create', 'read', 'update']
    };

    const clientAdminPermissionMap = {
      ...clientPermissionMap,
      'user': ['create', 'read', 'update', 'delete'],
      'billing': ['read'],
      'contact': ['create', 'read', 'update', 'delete'],
      'company': ['read', 'update'],
      'document': ['create', 'read', 'update', 'delete']
    };

    const dispatcherPermissionMap = {
      'schedule': ['create', 'read', 'update', 'delete'],
      'user': ['read'],
      'ticket': ['read', 'update'],
      'company': ['read'],
      'contact': ['read']
    };

    // --- Role-Permission Assignment ---
    const assignPermissionsToRole = async (roleName, permissions) => {
      const role = await db.table('roles')
        .where({ tenant })
        .whereRaw('LOWER(role_name) = ?', [roleName.toLowerCase()])
        .first();

      if (role) {
        for (const perm of permissions) {
          const exists = await db.table('role_permissions')
            .where({
              tenant,
              role_id: role.role_id,
              permission_id: perm.permission_id
            })
            .first();

          if (!exists) {
            await db.table('role_permissions').insert({
              tenant,
              role_id: role.role_id,
              permission_id: perm.permission_id
            });
          }
        }
      }
    };

    const clientPermissions = await getPermissions(clientPermissionMap);
    const clientAdminPermissions = await getPermissions(clientAdminPermissionMap);
    const dispatcherPermissions = await getPermissions(dispatcherPermissionMap);

    await assignPermissionsToRole('Client', clientPermissions);
    await assignPermissionsToRole('Client_Admin', clientAdminPermissions);
    await assignPermissionsToRole('Dispatcher', dispatcherPermissions);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  // Get all tenants
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  const roleNames = ['Client', 'Client_Admin', 'Dispatcher'];

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    // Get the role IDs for the roles we are removing
    const rolesToDelete = await db.table('roles')
      .where({ tenant })
      .whereIn('role_name', roleNames)
      .select('role_id');

    const roleIdsToDelete = rolesToDelete.map(r => r.role_id);

    if (roleIdsToDelete.length > 0) {
      // Remove role permissions
      await db.table('role_permissions')
        .where({ tenant })
        .whereIn('role_id', roleIdsToDelete)
        .delete();

      // Remove roles
      await db.table('roles')
        .where({ tenant })
        .whereIn('role_id', roleIdsToDelete)
        .delete();
    }
  }
};
