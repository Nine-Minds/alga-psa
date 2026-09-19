const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
exports.up = async function(knex) {
  if (!await knex.schema.hasTable('time_period_calendar_locks')) {
    await knex.schema.createTable('time_period_calendar_locks', table => table.uuid('tenant').primary());
  }
  await ensureTenantDistribution(knex, 'time_period_calendar_locks');
};
exports.down = async function(knex) { await knex.schema.dropTableIfExists('time_period_calendar_locks'); };
exports.config = { transaction: false };
