/**
 * Add Account Management permission for MSP Admin roles
 * - Adds the account_management permissions (read, update, delete) for MSP only
 * - Assigns the permissions to the MSP Admin role per tenant
 */

exports.up = async function up(knex) {
  const tenants = await knex('tenants').pluck('tenant');
  const actions = [
    { action: 'read', description: 'View account and subscription details' },
    { action: 'update', description: 'Manage account and subscription settings' },
    { action: 'delete', description: 'Cancel subscription and delete account' },
  ];

  for (const tenant of tenants) {
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const { action, description } of actions) {
      const permission = await knex('permissions')
        .where({ tenant, resource: 'account_management', action })
        .first();

      let permissionId;

      if (permission) {
        permissionId = permission.permission_id;

        // Update to ensure it's MSP-only
        if (!permission.msp || permission.client || (!permission.description && description)) {
          await knex('permissions')
            .where({ permission_id: permissionId })
            .update({
              msp: true,
              client: false,
              description: permission.description || description,
            });
        }
      } else {
        const [inserted] = await knex('permissions')
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

      const assignment = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id, permission_id: permissionId })
        .first();

      if (!assignment) {
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
  const actions = ['read', 'update', 'delete'];

  for (const tenant of tenants) {
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    for (const action of actions) {
      const permission = await knex('permissions')
        .where({ tenant, resource: 'account_management', action })
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
        .delete();
    }
  }
};
