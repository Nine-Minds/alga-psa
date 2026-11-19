/** Shared pool reader seam: all legacy allocations remain paid; EE may add pilot funding. */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('co_managed_allocations', 'funding_source'))) {
    await knex.schema.alterTable('co_managed_allocations', (table) => {
      table.text('funding_source').notNullable().defaultTo('paid');
    });
  }
  await knex.raw('ALTER TABLE co_managed_allocations DROP CONSTRAINT IF EXISTS co_managed_allocations_funding_source_check');
  await knex.raw(`ALTER TABLE co_managed_allocations ADD CONSTRAINT co_managed_allocations_funding_source_check
    CHECK (funding_source IN ('paid', 'seat_trial')) NOT VALID`);
};
exports.down = async function down(knex) {
  if (await knex('co_managed_allocations').where('funding_source', 'seat_trial').first()) {
    throw new Error('Cannot remove allocation funding while pilot allocations exist');
  }
  await knex.raw('ALTER TABLE co_managed_allocations DROP CONSTRAINT IF EXISTS co_managed_allocations_funding_source_check');
  await knex.schema.alterTable('co_managed_allocations', (table) => table.dropColumn('funding_source'));
};
