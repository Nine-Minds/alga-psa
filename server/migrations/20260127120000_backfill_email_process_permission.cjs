exports.up = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  const permission = {
    resource: 'email',
    action: 'process',
    msp: true,
    client: false,
    description: 'Process outbound email'
  };

  for (const { tenant } of tenants) {
    const existing = await knex('permissions')
      .where({ tenant, resource: permission.resource, action: permission.action })
      .select('permission_id')
      .limit(1);

    if (!existing.length) {
      await knex('permissions').insert({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        created_at: new Date(),
        ...permission
      });
    }

    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first();

    if (!adminRole) continue;

    const permRow = await knex('permissions')
      .where({ tenant, resource: permission.resource, action: permission.action })
      .first();

    if (!permRow?.permission_id) continue;

    const hasRolePerm = await knex('role_permissions')
      .where({ tenant, role_id: adminRole.role_id, permission_id: permRow.permission_id })
      .first();

    if (!hasRolePerm) {
      await knex('role_permissions').insert({
        tenant,
        role_id: adminRole.role_id,
        permission_id: permRow.permission_id
      });
    }
  }
};

exports.down = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    const perms = await knex('permissions')
      .where({ tenant, resource: 'email', action: 'process' })
      .select('permission_id');

    const permIds = perms.map((p) => p.permission_id);
    if (!permIds.length) continue;

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permIds)
      .del();

    await knex('permissions')
      .where({ tenant, resource: 'email', action: 'process' })
      .del();
  }
};

