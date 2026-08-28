const { reconcileAllTenants } = require('../../migrations/utils/permissions/reconcileTenants.cjs');

// Thin adapter over the unified permission catalog
// (server/migrations/utils/permissions). Keeping the developer database on the
// same definitions as onboarding is what stops a dev-only permission from
// masking a missing onboarding entry.
//
// Strict, unlike the reconciliation migrations: a drifted developer tenant is a
// bug to see now, not history to route around.
exports.seed = (knex) => reconcileAllTenants(knex, { label: 'dev-seed permissions', onDrift: 'throw' });
