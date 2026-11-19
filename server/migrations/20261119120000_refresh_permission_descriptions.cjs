/**
 * Refresh permission descriptions for every tenant.
 *
 * The Settings > Security > Permissions matrix shows each permission's
 * description as its tooltip. The old descriptions named the resource, not the
 * screens it unlocks (quotes run on `billing`, yet `billing:update` read "Modify
 * billing records and rates"), so admins could not tell what to grant.
 *
 * The new text lives in the catalog (./utils/permissions/catalog.cjs). Sync
 * refreshes catalog-owned descriptions and writes nothing else for a tenant
 * that is already reconciled.
 */

const { reconcileAllTenants } = require('./utils/permissions/reconcileTenants.cjs');

exports.up = async function up(knex) {
  // migration-lint: allow 8 - reconcileAllTenants is the repo-standard, additive, per-tenant-idempotent way to apply catalog changes (server/migrations/utils/permissions/README.md); this one only refreshes descriptions
  await reconcileAllTenants(knex, { label: 'refresh_permission_descriptions' });
};

exports.down = async function down() {
  // Descriptions are display text; the previous wording is not restored.
};

exports.config = { transaction: false };
