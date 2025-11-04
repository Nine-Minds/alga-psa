/**
 * Introduce settings.import_export permissions and default role assignments.
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) {
    return;
  }

  const ensurePermission = async (tenant, resource, action, description) => {
    const existing = await knex('permissions')
      .where({ tenant, resource, action })
      .first();

    if (existing) {
      if (existing.description !== description || existing.msp !== true || existing.client !== false) {
        await knex('permissions')
          .where({ tenant, permission_id: existing.permission_id })
          .update({
            description,
            msp: true,
            client: false
          });
      }
      return existing;
    }

    const [permission] = await knex('permissions')
      .insert({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        resource,
        action,
        description,
        msp: true,
        client: false,
        created_at: knex.fn.now()
      })
      .returning('*');

    return permission;
  };

  const assignPermission = async (tenant, roleId, permissionId) => {
    const existing = await knex('role_permissions')
      .where({
        tenant,
        role_id: roleId,
        permission_id: permissionId
      })
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

  for (const { tenant } of tenants) {
    const readPermission = await ensurePermission(
      tenant,
      'import_export',
      'read',
      'View asset import/export settings and history'
    );
    const managePermission = await ensurePermission(
      tenant,
      'import_export',
      'manage',
      'Create and execute asset imports'
    );

    const roles = await knex('roles')
      .where({ tenant })
      .andWhere({ msp: true });

    const adminRole = roles.find((role) => role.role_name?.toLowerCase() === 'admin');
    const dispatcherRole = roles.find((role) => role.role_name?.toLowerCase() === 'dispatcher');
    const technicianRole = roles.find((role) => role.role_name?.toLowerCase() === 'technician');

    if (adminRole) {
      await assignPermission(tenant, adminRole.role_id, readPermission.permission_id);
      await assignPermission(tenant, adminRole.role_id, managePermission.permission_id);
    }

    if (dispatcherRole) {
      await assignPermission(tenant, dispatcherRole.role_id, readPermission.permission_id);
    }

    if (technicianRole) {
      // Technicians intentionally receive no new permissions for imports.
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) {
    return;
  }

  for (const { tenant } of tenants) {
    const permissions = await knex('permissions')
      .where({ tenant })
      .whereIn('resource', ['import_export'])
      .whereIn('action', ['read', 'manage']);

    if (!permissions.length) {
      continue;
    }

    const permissionIds = permissions.map((permission) => permission.permission_id);

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await knex('permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();
  }
};
