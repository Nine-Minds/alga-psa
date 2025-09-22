/**
 * Ensure MSP Admin roles can manage portal settings
 * - Adds/updates the settings:update permission for MSP
 * - Assigns the permission to the MSP Admin role per tenant
 */

exports.up = async function up(knex) {
  const tenants = await knex('tenants').pluck('tenant');

  for (const tenant of tenants) {
    // Find or create the settings:update permission for MSP context
    const existingPermission = await knex('permissions')
      .where({ tenant, resource: 'settings', action: 'update' })
      .first();

    let permissionId;

    if (existingPermission) {
      permissionId = existingPermission.permission_id;

      if (!existingPermission.msp || !existingPermission.client) {
        await knex('permissions')
          .where({ permission_id: permissionId })
          .update({ msp: true, client: true, updated_at: knex.fn.now() });
      }
    } else {
      const [inserted] = await knex('permissions')
        .insert({
          permission_id: knex.raw('gen_random_uuid()'),
          tenant,
          resource: 'settings',
          action: 'update',
          msp: true,
          client: true,
          description: 'Manage portal settings',
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        })
        .returning(['permission_id']);

      permissionId = inserted.permission_id;
    }

    if (!permissionId) {
      continue;
    }

    // Assign to MSP Admin role
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    if (!adminRole) {
      continue;
    }

    const existingAssignment = await knex('role_permissions')
      .where({ tenant, role_id: adminRole.role_id, permission_id: permissionId })
      .first();

    if (!existingAssignment) {
      await knex('role_permissions').insert({
        tenant,
        role_id: adminRole.role_id,
        permission_id: permissionId,
        created_at: knex.fn.now(),
      });
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').pluck('tenant');

  for (const tenant of tenants) {
    const permission = await knex('permissions')
      .where({ tenant, resource: 'settings', action: 'update' })
      .first();

    if (!permission) {
      continue;
    }

    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    if (adminRole) {
      await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permission.permission_id })
        .delete();
    }

    await knex('permissions')
      .where({ permission_id: permission.permission_id })
      .update({ msp: false, client: true, updated_at: knex.fn.now() });
  }
};
