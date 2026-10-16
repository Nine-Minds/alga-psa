const { forCoManagedTenants } = require('../lib/coManagedSeeds.cjs');
const shared = require('../psa/09_asset_type_registry.cjs');
exports.seed = (knex, tenantId) => forCoManagedTenants(knex, tenantId, tenant => shared.seed(knex, tenant));
