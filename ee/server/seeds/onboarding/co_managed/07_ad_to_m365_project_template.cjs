const { forCoManagedTenants } = require('../lib/coManagedSeeds.cjs');
const shared = require('../psa/07_ad_to_m365_project_template.cjs');
exports.seed = (knex, tenantId) => forCoManagedTenants(knex, tenantId, tenant => shared.seed(knex, tenant));
