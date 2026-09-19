/**
 * Remove the orphan credit:reconcile permission.
 *
 * The credit-reconciliation actions standardize on billing:read (view) and
 * billing:update (resolve/fix); nothing ever checked credit:reconcile, so the
 * seeded permission was a second, dead source of truth. Drop it and any role
 * assignments referencing it.
 */
exports.up = async function up(knex) {
  const permissions = await knex('permissions')
    .where({ resource: 'credit', action: 'reconcile' })
    .select('permission_id', 'tenant');

  for (const permission of permissions) {
    await knex('role_permissions')
      .where({ tenant: permission.tenant, permission_id: permission.permission_id })
      .del();
    await knex('permissions')
      .where({ tenant: permission.tenant, permission_id: permission.permission_id })
      .del();
  }
};

exports.down = async function down(knex) {
  // Intentionally a no-op: the permission was never checked by any code path,
  // so there is nothing meaningful to restore.
};
