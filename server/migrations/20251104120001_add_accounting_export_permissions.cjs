/**
 * Seed accounting export permissions for MSP roles.
 *
 * Adds create/read/update/execute permissions for the `accountingExports` resource
 * and grants them to common internal roles (admin, owner, finance).
 */

const PERMISSIONS = [
  { resource: 'accountingExports', action: 'create', description: 'Create accounting export batches' },
  { resource: 'accountingExports', action: 'read', description: 'Access accounting export batches' },
  { resource: 'accountingExports', action: 'update', description: 'Modify accounting export batches' },
  { resource: 'accountingExports', action: 'execute', description: 'Execute accounting export batches' }
];

const TARGET_ROLES = ['admin', 'owner', 'finance'];

async function insertPermission(knex, tenant, resource, action, description) {
  const existing = await knex('permissions')
    .where({ tenant, resource, action })
    .first();

  if (existing) {
    return existing.permission_id;
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

  return permission.permission_id;
}

async function grantPermissionToRoles(knex, tenant, permissionId) {
  const roles = await knex('roles')
    .where({ tenant })
    .whereIn(knex.raw('LOWER(role_name)'), TARGET_ROLES.map((name) => name.toLowerCase()));

  for (const role of roles) {
    const exists = await knex('role_permissions')
      .where({ tenant, role_id: role.role_id, permission_id: permissionId })
      .first();

    if (!exists) {
      await knex('role_permissions').insert({
        tenant,
        role_id: role.role_id,
        permission_id: permissionId
      });
    }
  }
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) {
    return;
  }

  for (const { tenant } of tenants) {
    for (const permission of PERMISSIONS) {
      const permissionId = await insertPermission(
        knex,
        tenant,
        permission.resource,
        permission.action,
        permission.description
      );
      await grantPermissionToRoles(knex, tenant, permissionId);
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) {
    return;
  }

  for (const { tenant } of tenants) {
    const permissionIds = await knex('permissions')
      .where({ tenant, resource: 'accountingExports' })
      .select('permission_id');

    if (!permissionIds.length) {
      continue;
    }

    const ids = permissionIds.map((p) => p.permission_id);

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', ids)
      .del();

    await knex('permissions')
      .where({ tenant, resource: 'accountingExports' })
      .del();
  }
};
