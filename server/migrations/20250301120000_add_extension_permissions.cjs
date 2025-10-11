/**
 * Adds extension read/write permissions for all tenants and ensures MSP Admin has them.
 */

exports.up = async function up(knex) {
  const tenants = await knex('tenants').pluck('tenant');
  if (!tenants.length) {
    return;
  }

  for (const tenant of tenants) {
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    const actions = [
      { action: 'read', description: 'Read extension APIs and storage' },
      { action: 'write', description: 'Write extension APIs and storage' },
    ];

    for (const { action, description } of actions) {
      const existing = await knex('permissions')
        .where({ tenant, resource: 'extension', action })
        .first(['permission_id', 'msp', 'description']);

      let permissionId = existing?.permission_id;

      if (existing) {
        if (!existing.msp || !existing.description) {
          await knex('permissions')
            .where({ permission_id: existing.permission_id })
            .update({
              msp: true,
              description: existing.description || description,
            });
        }
      } else {
        const [inserted] = await knex('permissions')
          .insert({
            permission_id: knex.raw('gen_random_uuid()'),
            tenant,
            resource: 'extension',
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
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').pluck('tenant');
  if (!tenants.length) {
    return;
  }

  for (const tenant of tenants) {
    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    const permissions = await knex('permissions')
      .where({ tenant, resource: 'extension' })
      .whereIn('action', ['read', 'write'])
      .select(['permission_id']);

    for (const permission of permissions) {
      if (adminRole) {
        await knex('role_permissions')
          .where({ tenant, role_id: adminRole.role_id, permission_id: permission.permission_id })
          .delete();
      }
    }

    await knex('permissions')
      .where({ tenant, resource: 'extension' })
      .whereIn('action', ['read', 'write'])
      .delete();
  }
};
