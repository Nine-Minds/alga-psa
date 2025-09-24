/**
 * Ensure MSP Admin roles can manage portal settings
 * - Adds/updates the settings:update permission for MSP
 * - Assigns the permission to the MSP Admin role per tenant
 */

exports.up = async function up(knex) {
  const tenants = await knex('tenants').pluck('tenant');
  const actions = [
    { action: 'read', description: 'View portal settings' },
    { action: 'create', description: 'Create portal settings' },
    { action: 'update', description: 'Manage portal settings' },
    { action: 'delete', description: 'Delete portal settings' },
  ];

  for (const tenant of tenants) {
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const { action, description } of actions) {
      const existingPermission = await knex('permissions')
        .where({ tenant, resource: 'settings', action })
        .first();

      let permissionId;

      if (existingPermission) {
        permissionId = existingPermission.permission_id;

        if (!existingPermission.msp || !existingPermission.client || (!existingPermission.description && description)) {
          await knex('permissions')
            .where({ permission_id: permissionId })
            .update({
              msp: true,
              client: true,
              description: existingPermission.description || description,
            });
        }
      } else {
        const [inserted] = await knex('permissions')
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

      const hasAssignment = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permissionId })
        .first();

      if (!hasAssignment) {
        await knex('role_permissions').insert({
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
  const tenants = await knex('tenants').pluck('tenant');
  const actions = ['read', 'create', 'update', 'delete'];

  for (const tenant of tenants) {
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const action of actions) {
      const permission = await knex('permissions')
        .where({ tenant, resource: 'settings', action })
        .first();

      if (!permission) {
        continue;
      }

      if (adminRole) {
        await knex('role_permissions')
          .where({ tenant, role_id: adminRole.role_id, permission_id: permission.permission_id })
          .delete();
      }

      await knex('permissions')
        .where({ permission_id: permission.permission_id })
        .update({ msp: false, client: true });
    }
  }
};
