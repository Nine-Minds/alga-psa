/**
 * CM L4c repair: a co_managed customer's portal roles can read and reply on shared-task requester threads.
 *
 * Declared in the unified catalog (utils/permissions/catalog.cjs), co_managed ONLY:
 *   - client `project:read`            -> client:Admin, client:User   (the psa grant is unchanged)
 *   - client `project_task_comment:create` -> client:Admin, client:User (no psa entry: DO-NOT-PORT #27)
 * This reconciles existing CO_MANAGED tenants only (psa and algadesk tenants are never enumerated), additively.
 * Sponsor workspaces keep their own seeding at admission; see the card summary for that open item.
 *
 * down removes only these two client permission identities' grants from the default client Admin/User roles
 * of co_managed tenants, then the permission rows if nothing else still references them. Idempotent both ways.
 */
const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

const ADDED = [
  { resource: 'project', action: 'read' },
  { resource: 'project_task_comment', action: 'create' },
];

exports.up = async function up(knex) {
  // migration-lint: allow 8 - reconcileAllTenants is the repo-standard, additive, per-tenant-idempotent way to provision a catalog permission (server/migrations/utils/permissions/README.md, "Adding a permission"); the entries are declared in catalog.cjs and scoped to product co_managed
  await reconcileAllTenants(knex, { label: 'add_co_managed_requester_task_thread_permissions', product: 'co_managed' });
};

exports.down = async function down(knex) {
  const tenants = (await knex('tenants').where({ product_code: 'co_managed' }).select('tenant')).map((row) => row.tenant);
  for (const tenant of tenants) {
    await knex.transaction(async (trx) => {
      const roles = await trx('roles').where({ tenant, client: true, msp: false }).whereIn('role_name', ['Admin', 'User']).select('role_id');
      for (const { resource, action } of ADDED) {
        const permission = await trx('permissions').where({ tenant, resource, action, client: true, msp: false }).first('permission_id');
        if (!permission) continue;
        await trx('role_permissions').where({ tenant, permission_id: permission.permission_id }).whereIn('role_id', roles.map((role) => role.role_id)).del();
        const stillUsed = await trx('role_permissions').where({ tenant, permission_id: permission.permission_id }).first('role_id');
        if (!stillUsed) await trx('permissions').where({ tenant, permission_id: permission.permission_id }).del();
      }
    });
  }
};

exports.config = { transaction: false };
