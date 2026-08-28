/**
 * Locates the unified permission catalog from an onboarding seed.
 *
 * Seeds run from two layouts: the source checkout, and the Temporal worker image
 * where the seed tree is copied to dist/seeds/onboarding and the catalog to
 * dist/seeds/permissions (see ee/temporal-workflows/Dockerfile). Resolve both
 * rather than assuming a developer checkout exists at runtime.
 */

const fs = require('fs');
const path = require('path');

const CANDIDATE_ROOTS = [
  path.resolve(__dirname, '../../../../../server/migrations/utils/permissions'),
  path.resolve(__dirname, '../../permissions'),
];

function resolveCatalogRoot() {
  for (const root of CANDIDATE_ROOTS) {
    if (fs.existsSync(path.join(root, 'catalog.cjs'))) return root;
  }
  throw new Error(
    `Permission catalog not found. Looked in:\n  - ${CANDIDATE_ROOTS.join('\n  - ')}`,
  );
}

const catalogRoot = resolveCatalogRoot();
const catalog = require(path.join(catalogRoot, 'catalog.cjs'));
const roleGrants = require(path.join(catalogRoot, 'roleGrants.cjs'));
const sync = require(path.join(catalogRoot, 'syncPermissionCatalog.cjs'));
const reconcile = require(path.join(catalogRoot, 'reconcileTenants.cjs'));

module.exports = {
  catalogRoot,
  catalog,
  roleGrants,
  applyDefaultRoleGrants: sync.applyDefaultRoleGrants,
  syncPermissionCatalog: sync.syncPermissionCatalog,
  listTenantsForProduct: sync.listTenantsForProduct,
  reconcileAllTenants: reconcile.reconcileAllTenants,
};
