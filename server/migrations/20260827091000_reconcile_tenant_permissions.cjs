/**
 * Reconciles every tenant against the permission catalog so the resurrected
 * Secrets settings screen (and everything else added since a tenant was
 * provisioned) has the permissions it gates on.
 *
 * Originally written against a second catalog of its own; it now runs the
 * unified catalog in server/migrations/utils/permissions, which is a superset
 * of what it used to insert. Additive, idempotent, and it skips rather than
 * fails on a tenant whose roles or product_code have drifted.
 *
 * The two identities its first version deleted (client_documents:read,
 * credit:reconcile — the latter already removed by 20260727120000) are left
 * alone: catalog synchronization never deletes, because a tenant may have
 * granted a retired permission to a custom role. Cleanup is its own
 * operator-gated migration; see ./utils/permissions/README.md.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async (knex) => {
  await reconcileAllTenants(knex, { label: 'reconcile_tenant_permissions' });
};

exports.down = async () => {};

exports.config = { transaction: false };
