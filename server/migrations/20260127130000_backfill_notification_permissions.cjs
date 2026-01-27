exports.up = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  const permissions = [
    { resource: 'notification', action: 'read', msp: true, client: false, description: 'Read notifications' },
    { resource: 'notification', action: 'manage', msp: true, client: false, description: 'Manage notifications' }
  ];

  for (const { tenant } of tenants) {
    const existing = await knex('permissions')
      .where({ tenant, resource: 'notification' })
      .select('permission_id', 'action');

    const existingActions = new Set(existing.map((p) => p.action));

    const toInsert = permissions
      .filter((p) => !existingActions.has(p.action))
      .map((p) => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        created_at: new Date(),
        ...p
      }));

    if (toInsert.length) {
      await knex('permissions').insert(toInsert);
    }

    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first();

    if (!adminRole) continue;

    const permRows = await knex('permissions')
      .where({ tenant, resource: 'notification' })
      .whereIn('action', permissions.map((p) => p.action))
      .select('permission_id');

    if (!permRows.length) continue;

    const existingRolePerms = await knex('role_permissions')
      .where({ tenant, role_id: adminRole.role_id })
      .whereIn('permission_id', permRows.map((p) => p.permission_id))
      .select('permission_id');

    const existingRolePermIds = new Set(existingRolePerms.map((rp) => rp.permission_id));

    const rolePermsToInsert = permRows
      .filter((p) => !existingRolePermIds.has(p.permission_id))
      .map((p) => ({
        tenant,
        role_id: adminRole.role_id,
        permission_id: p.permission_id
      }));

    if (rolePermsToInsert.length) {
      await knex('role_permissions').insert(rolePermsToInsert);
    }
  }
};

exports.down = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  const actions = ['read', 'manage'];

  for (const { tenant } of tenants) {
    const perms = await knex('permissions')
      .where({ tenant, resource: 'notification' })
      .whereIn('action', actions)
      .select('permission_id');

    const permIds = perms.map((p) => p.permission_id);
    if (!permIds.length) continue;

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permIds)
      .del();

    await knex('permissions')
      .where({ tenant, resource: 'notification' })
      .whereIn('action', actions)
      .del();
  }
};

