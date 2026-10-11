const { reconcileAllTenants } = require('../lib/permissionCatalog.cjs');
exports.seed = (knex, tenantId) => reconcileAllTenants(knex, {
  label: 'co-managed onboarding permissions', product: 'co_managed', tenantId, onDrift: 'throw',
});
