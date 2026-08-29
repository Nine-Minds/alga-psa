const { reconcileAllTenants } = require('../lib/permissionCatalog.cjs');

// Additive default-role grants from the unified permission catalog.
//
// This seed used to clear role_permissions before rebuilding it, which erased
// every grant a tenant administrator had added. Grants are now inserted
// conflict-safely: custom roles and extra grants on default roles survive a
// retry, an appliance seed replay, and a product upgrade.
exports.seed = (knex, tenantId) => reconcileAllTenants(knex, {
    label: 'psa onboarding role grants',
    apply: 'grants',
    product: 'psa',
    tenantId,
    onDrift: 'throw',
});
