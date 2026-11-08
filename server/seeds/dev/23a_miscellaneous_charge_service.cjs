const { seedTenant } = require('../../migrations/20260929010000_seed_miscellaneous_charge_service.cjs');
exports.seed = async function(knex) {
  for (const { tenant } of await knex('tenants').select('tenant')) await seedTenant(knex, tenant);
};
