const { reconcileAllTenants } = require('../lib/permissionCatalog.cjs');

// Additive default-role grants from the unified permission catalog.
// See the PSA sibling seed for why the blanket delete is gone.
exports.seed = (knex, tenantId) => reconcileAllTenants(knex, {
    label: 'algadesk onboarding role grants',
    apply: 'grants',
    product: 'algadesk',
    tenantId,
    onDrift: 'throw',
});
