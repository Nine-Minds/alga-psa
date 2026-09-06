const { reconcileAllTenants } = require('../lib/permissionCatalog.cjs');
exports.seed = (knex, tenantId) => reconcileAllTenants(knex, {
  label: 'co-managed onboarding role grants', apply: 'grants', product: 'co_managed', tenantId, onDrift: 'throw',
});
