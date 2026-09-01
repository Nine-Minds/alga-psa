const { reconcileAllTenants } = require('../lib/permissionCatalog.cjs');

// Thin adapter over the unified permission catalog
// (server/migrations/utils/permissions). Permission definitions live there, not
// here, so onboarding, developer seeds and reconciliation migrations can never
// drift apart again.
//
// Strict: onboarding owns the tenant it just created, so a tenant it cannot
// reconcile must fail the workflow rather than go live under-permissioned.
exports.seed = (knex, tenantId) => reconcileAllTenants(knex, {
    label: 'psa onboarding permissions',
    product: 'psa',
    tenantId,
    onDrift: 'throw',
});
