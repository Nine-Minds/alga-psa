exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    let permission = await knex('permissions')
      .where({ tenant, resource: 'quotes', action: 'approve' })
      .first(['permission_id', 'description', 'msp', 'client']);

    if (!permission) {
      const [inserted] = await knex('permissions')
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
      await knex('permissions')
        .where({ tenant, permission_id: permission.permission_id })
        .update({
          msp: true,
          client: false,
          description: permission.description || 'Approve or request changes to quotes pending internal approval',
          updated_at: knex.fn.now(),
        });
    }

    const adminRoles = await knex('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', ['Admin'])
      .select('role_id');

    for (const role of adminRoles) {
      const existingRolePermission = await knex('role_permissions')
        .where({ tenant, role_id: role.role_id, permission_id: permission.permission_id })
        .first('tenant');

      if (!existingRolePermission) {
        await knex('role_permissions').insert({
          tenant,
          role_id: role.role_id,
          permission_id: permission.permission_id,
        });
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    const permissionIds = await knex('permissions')
      .where({ tenant, resource: 'quotes', action: 'approve' })
      .pluck('permission_id');

    if (permissionIds.length === 0) {
      continue;
    }

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await knex('permissions')
      .where({ tenant, resource: 'quotes', action: 'approve' })
      .del();
  }
};
