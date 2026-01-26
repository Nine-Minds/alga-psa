exports.up = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  const workflowPermissions = [
    { resource: 'workflow', action: 'read', msp: true, client: false, description: 'Read workflows' },
    { resource: 'workflow', action: 'view', msp: true, client: false, description: 'View workflows' },
    { resource: 'workflow', action: 'manage', msp: true, client: false, description: 'Manage workflows' },
    { resource: 'workflow', action: 'publish', msp: true, client: false, description: 'Publish workflows' },
    { resource: 'workflow', action: 'admin', msp: true, client: false, description: 'Administer workflows' },
  ];

  for (const { tenant } of tenants) {
    const existingPerms = await knex('permissions')
      .where({ tenant })
      .where('resource', 'workflow')
      .select('permission_id', 'action');

    const existingActionToId = new Map(existingPerms.map((p) => [p.action, p.permission_id]));

    const permissionsToInsert = workflowPermissions
      .filter((p) => !existingActionToId.has(p.action))
      .map((p) => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        created_at: new Date(),
        ...p,
      }));

    if (permissionsToInsert.length) {
      await knex('permissions').insert(permissionsToInsert);
    }

    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first();

    if (!adminRole) continue;

    const workflowPermIds = await knex('permissions')
      .where({ tenant, resource: 'workflow' })
      .whereIn('action', workflowPermissions.map((p) => p.action))
      .select('permission_id');

    if (!workflowPermIds.length) continue;

    const existingRolePerms = await knex('role_permissions')
      .where({ tenant, role_id: adminRole.role_id })
      .whereIn('permission_id', workflowPermIds.map((p) => p.permission_id))
      .select('permission_id');

    const existingRolePermIds = new Set(existingRolePerms.map((rp) => rp.permission_id));

    const rolePermissionsToInsert = workflowPermIds
      .filter((p) => !existingRolePermIds.has(p.permission_id))
      .map((p) => ({
        tenant,
        role_id: adminRole.role_id,
        permission_id: p.permission_id,
      }));

    if (rolePermissionsToInsert.length) {
      await knex('role_permissions').insert(rolePermissionsToInsert);
    }
  }
};

exports.down = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  const actions = ['read', 'view', 'manage', 'publish', 'admin'];

  for (const { tenant } of tenants) {
    const perms = await knex('permissions')
      .where({ tenant, resource: 'workflow' })
      .whereIn('action', actions)
      .select('permission_id');

    const permIds = perms.map((p) => p.permission_id);
    if (!permIds.length) continue;

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permIds)
      .del();

    await knex('permissions')
      .where({ tenant })
      .whereIn('permission_id', permIds)
      .del();
  }
};

