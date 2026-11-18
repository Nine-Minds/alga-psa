const { forCoManagedTenants } = require('../lib/coManagedSeeds.cjs');
const shared = require('../psa/06_project_task_statuses.cjs');
exports.seed = (knex, tenantId) => forCoManagedTenants(knex, tenantId, tenant => shared.seed(knex, tenant));
