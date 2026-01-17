/**
 * Add Alga Guard permissions to the system
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // Helper function to create a permission if it doesn't exist
  const ensurePermission = async (tenant, resource, action, msp = true, client = false, description = null) => {
    const existing = await knex('permissions')
      .where({ tenant, resource, action })
      .first();

    if (!existing) {
      const [permission] = await knex('permissions')
        .insert({
          tenant,
          resource,
          action,
          msp,
          client,
          description,
          permission_id: knex.raw('gen_random_uuid()'),
          created_at: knex.fn.now()
        })
        .returning('*');
      return permission;
    }

    // Update existing permission
    await knex('permissions')
      .where({ tenant, resource, action })
      .update({ msp, client, description });

    return existing;
  };

  // Helper function to assign permission to role
  const assignPermissionToRole = async (tenant, roleId, permissionId) => {
    const existing = await knex('role_permissions')
      .where({ tenant, role_id: roleId, permission_id: permissionId })
      .first();

    if (!existing) {
      await knex('role_permissions').insert({
        tenant,
        role_id: roleId,
        permission_id: permissionId,
        created_at: knex.fn.now()
      });
    }
  };

  // Get all tenants
  const tenants = await knex('tenants').select('tenant');

  // Define Alga Guard permissions
  const guardPermissions = [
    // PII Scanner permissions
    { resource: 'guard:pii', action: 'view', msp: true, client: false, description: 'View PII scan results and dashboards' },
    { resource: 'guard:pii', action: 'manage_profiles', msp: true, client: false, description: 'Create, edit, delete scan profiles' },
    { resource: 'guard:pii', action: 'execute_scan', msp: true, client: false, description: 'Trigger on-demand scans' },
    { resource: 'guard:pii', action: 'purge_results', msp: true, client: false, description: 'Delete individual scan results' },
    { resource: 'guard:pii', action: 'purge_all', msp: true, client: false, description: 'Delete all scan results (admin)' },
    { resource: 'guard:pii', action: 'generate_reports', msp: true, client: false, description: 'Generate PII reports' },

    // ASM permissions
    { resource: 'guard:asm', action: 'view', msp: true, client: false, description: 'View ASM results and dashboards' },
    { resource: 'guard:asm', action: 'manage_domains', msp: true, client: false, description: 'Add, edit, remove domains' },
    { resource: 'guard:asm', action: 'execute_scan', msp: true, client: false, description: 'Trigger on-demand ASM scans' },
    { resource: 'guard:asm', action: 'generate_reports', msp: true, client: false, description: 'Generate ASM reports' },
    { resource: 'guard:asm', action: 'configure_scanners', msp: true, client: false, description: 'Configure scanner pods (admin)' },

    // Security Score permissions
    { resource: 'guard:score', action: 'view', msp: true, client: false, description: 'View security scores' },
    { resource: 'guard:score', action: 'generate_reports', msp: true, client: false, description: 'Generate score reports' },
    { resource: 'guard:score', action: 'configure_weights', msp: true, client: false, description: 'Configure score weights (admin)' },

    // Scheduling permissions
    { resource: 'guard:schedules', action: 'manage', msp: true, client: false, description: 'Create, edit, delete scan schedules' },
  ];

  // Define role permission mappings
  const rolePermissionMappings = {
    'Admin': guardPermissions.map(p => `${p.resource}:${p.action}`),
    'MSP Admin': guardPermissions.map(p => `${p.resource}:${p.action}`),
    'Technician': [
      'guard:pii:view', 'guard:pii:manage_profiles', 'guard:pii:execute_scan',
      'guard:pii:purge_results', 'guard:pii:generate_reports',
      'guard:asm:view', 'guard:asm:manage_domains', 'guard:asm:execute_scan',
      'guard:asm:generate_reports',
      'guard:score:view', 'guard:score:generate_reports',
      'guard:schedules:manage',
    ],
    'Viewer': [
      'guard:pii:view', 'guard:asm:view', 'guard:score:view',
    ],
  };

  for (const { tenant } of tenants) {
    console.log(`Adding Alga Guard permissions for tenant: ${tenant}`);

    // Create all permissions
    const permissionMap = new Map();
    for (const perm of guardPermissions) {
      const permission = await ensurePermission(
        tenant,
        perm.resource,
        perm.action,
        perm.msp,
        perm.client,
        perm.description
      );
      permissionMap.set(`${perm.resource}:${perm.action}`, permission.permission_id);
    }

    // Assign permissions to roles
    for (const [roleName, permKeys] of Object.entries(rolePermissionMappings)) {
      // Find the role by name (MSP roles only)
      const role = await knex('roles')
        .where({ tenant, role_name: roleName, msp: true })
        .first();

      if (role) {
        console.log(`Assigning Alga Guard permissions to role: ${roleName}`);
        for (const permKey of permKeys) {
          const permissionId = permissionMap.get(permKey);
          if (permissionId) {
            await assignPermissionToRole(tenant, role.role_id, permissionId);
          }
        }
      }
    }
  }

  console.log('Alga Guard permissions migration completed');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // Remove Alga Guard permissions
  const guardResources = ['guard:pii', 'guard:asm', 'guard:score', 'guard:schedules'];

  // Get all tenants
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    // Get all guard permission IDs
    const permissions = await knex('permissions')
      .where({ tenant })
      .whereIn('resource', guardResources)
      .select('permission_id');

    const permissionIds = permissions.map(p => p.permission_id);

    if (permissionIds.length > 0) {
      // Remove role_permissions entries
      await knex('role_permissions')
        .where({ tenant })
        .whereIn('permission_id', permissionIds)
        .delete();

      // Remove permissions
      await knex('permissions')
        .where({ tenant })
        .whereIn('resource', guardResources)
        .delete();
    }
  }
};
