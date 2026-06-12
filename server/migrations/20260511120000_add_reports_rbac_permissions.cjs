/**
 * Add RBAC permissions for the reports workspace.
 *
 * Admin roles get full report-management permissions. Existing operational MSP
 * roles get read access so canned reports remain available after the gate is
 * enforced.
 */

const REPORT_PERMISSION_DEFS = [
  { resource: 'reports', action: 'create', msp: true, client: false, description: 'Create reports' },
  { resource: 'reports', action: 'read', msp: true, client: false, description: 'View reports' },
  { resource: 'reports', action: 'update', msp: true, client: false, description: 'Update reports' },
  { resource: 'reports', action: 'delete', msp: true, client: false, description: 'Delete reports' },
];

const REPORT_READ_ROLES = ['Finance', 'Manager', 'Technician', 'Project Manager', 'Dispatcher'];

async function ensurePermission(knex, tenant, def) {
  const existing = await knex('permissions')
    .where({ tenant, resource: def.resource, action: def.action })
    .first();

  if (existing) {
    if (existing.msp !== def.msp || existing.client !== def.client || existing.description !== def.description) {
      await knex('permissions')
        .where({ tenant, permission_id: existing.permission_id })
        .update({
          msp: def.msp,
          client: def.client,
          description: def.description,
          updated_at: knex.fn.now(),
        });
    }

    return existing.permission_id;
  }

  const [inserted] = await knex('permissions')
    .insert({
      tenant,
      resource: def.resource,
      action: def.action,
      msp: def.msp,
      client: def.client,
      description: def.description,
      created_at: knex.fn.now(),
    })
    .returning('permission_id');

  return inserted.permission_id;
}

async function assignPermission(knex, tenant, roleId, permissionId) {
  const existing = await knex('role_permissions')
    .where({ tenant, role_id: roleId, permission_id: permissionId })
    .first('tenant');

  if (existing) {
    return;
  }

  await knex('role_permissions').insert({
    tenant,
    role_id: roleId,
    permission_id: permissionId,
    created_at: knex.fn.now(),
  });
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    const permissionIdsByAction = new Map();

    for (const def of REPORT_PERMISSION_DEFS) {
      permissionIdsByAction.set(def.action, await ensurePermission(knex, tenant, def));
    }

    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin', msp: true })
      .first('role_id');

    if (adminRole) {
      for (const permissionId of permissionIdsByAction.values()) {
        await assignPermission(knex, tenant, adminRole.role_id, permissionId);
      }
    }

    const readPermissionId = permissionIdsByAction.get('read');
    const readRoles = await knex('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', REPORT_READ_ROLES)
      .select('role_id');

    for (const role of readRoles) {
      await assignPermission(knex, tenant, role.role_id, readPermissionId);
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  const actions = REPORT_PERMISSION_DEFS.map((def) => def.action);

  for (const { tenant } of tenants) {
    const permissionIds = await knex('permissions')
      .where({ tenant, resource: 'reports' })
      .whereIn('action', actions)
      .pluck('permission_id');

    if (!permissionIds.length) {
      continue;
    }

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await knex('permissions')
      .where({ tenant, resource: 'reports' })
      .whereIn('action', actions)
      .del();
  }
};
