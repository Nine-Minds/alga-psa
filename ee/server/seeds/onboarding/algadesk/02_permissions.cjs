const { reconcileAllTenants } = require('../lib/permissionCatalog.cjs');

// Thin adapter over the unified permission catalog
// (server/migrations/utils/permissions). See the PSA sibling seed.
exports.seed = (knex, tenantId) => reconcileAllTenants(knex, {
    label: 'algadesk onboarding permissions',
    product: 'algadesk',
    tenantId,
    onDrift: 'throw',
});
