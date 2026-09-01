const { reconcileAllTenants } = require('../../migrations/utils/permissions/reconcileTenants.cjs');

// Additive default-role grants from the unified permission catalog, for EVERY
// tenant in the developer database. This seed used to clear role_permissions
// first, so an individual rerun wiped grants; a competing version reconciled
// only the first tenant, leaving every other tenant's roles silently
// ungranted. Grants are now inserted conflict-safely, for all of them.
exports.seed = (knex) => reconcileAllTenants(knex, {
    label: 'dev-seed role grants',
    apply: 'grants',
    onDrift: 'throw',
});
