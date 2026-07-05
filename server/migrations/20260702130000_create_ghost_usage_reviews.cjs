/**
 * Create ghost_usage_reviews for AI-assisted review of material-less hardware tickets.
 */

const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  await knex.schema.createTable('ghost_usage_reviews', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('review_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('ticket_id').notNullable();
    table
      .text('ai_classification')
      .notNullable()
      .checkIn(['hardware_missing', 'no_hardware', 'unclear']);
    table.specificType('ai_confidence', 'numeric').nullable();
    table.text('ai_reason').nullable();
    table.text('ai_model').nullable();
    table
      .text('disposition')
      .notNullable()
      .defaultTo('pending')
      .checkIn(['pending', 'confirmed', 'dismissed']);
    table.uuid('reviewed_by').nullable();
    table.timestamp('reviewed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'review_id']);
    table.unique(['tenant', 'ticket_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'ticket_id']).references(['tenant', 'ticket_id']).inTable('tickets').onDelete('CASCADE');
    table.check(
      '?? IS NULL OR (?? >= 0 AND ?? <= 1)',
      ['ai_confidence', 'ai_confidence', 'ai_confidence'],
      'ghost_usage_reviews_ai_confidence_check'
    );
  });

  // Distribute on Citus (colocated with tenants).
  await ensureTenantDistribution(knex, 'ghost_usage_reviews');

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_ghost_usage_reviews_disposition
    ON ghost_usage_reviews (tenant, disposition);
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_ghost_usage_reviews_disposition;`);
  await knex.schema.dropTableIfExists('ghost_usage_reviews');
};

exports.config = { transaction: false };
