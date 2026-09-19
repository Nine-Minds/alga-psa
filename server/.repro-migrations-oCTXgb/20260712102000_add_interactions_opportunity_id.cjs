/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('interactions', (table) => {
    table.uuid('opportunity_id').nullable();
    table.foreign(['tenant', 'opportunity_id'], 'fk_interactions_opportunity')
      .references(['tenant', 'opportunity_id'])
      .inTable('opportunities');
  });

  await knex.raw('CREATE INDEX idx_interactions_tenant_opportunity ON interactions (tenant, opportunity_id)');
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_interactions_tenant_opportunity');
  await knex.raw('ALTER TABLE interactions DROP CONSTRAINT IF EXISTS fk_interactions_opportunity');
  await knex.schema.alterTable('interactions', (table) => {
    table.dropColumn('opportunity_id');
  });
};
