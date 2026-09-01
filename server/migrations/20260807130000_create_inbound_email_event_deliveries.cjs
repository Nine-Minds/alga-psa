/**
 * Durable inbound email consumer delivery ledger.
 *
 * One row per (tenant, outbox event, consumer) records that a downstream
 * notification consumer already produced its external effect for that event.
 * The primary key `(tenant, outbox_id, consumer)` is the database-enforced
 * dedupe: an outbox event may be published more than once (crash between Redis
 * accept and the Postgres `published` mark), but each consumer's effect is
 * produced at most once.
 *
 * The outbox remains at-least-once; this ledger makes the consumer side
 * idempotent without an in-memory set. The table is tenant-distributed and
 * colocated with the rest of the durable inbound email family. The only foreign
 * key is the composite (tenant, outbox_id) reference to `inbound_email_outbox`
 * within the family; there are no references to external entity tables.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

  const hasTable = await knex.schema.hasTable('inbound_email_event_deliveries');
  if (hasTable) return;

  await knex.schema.createTable('inbound_email_event_deliveries', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('outbox_id').notNullable();
    table.text('consumer').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'outbox_id', 'consumer']);
    table.foreign(['tenant', 'outbox_id'])
      .references(['tenant', 'outbox_id'])
      .inTable('inbound_email_outbox');
    table.index(['tenant', 'consumer', 'created_at'], 'inbound_email_event_deliveries_lookup_idx');
  });
  await ensureTenantDistribution(knex, 'inbound_email_event_deliveries');
};

/**
 * Local/test-only rollback. Production rollback keeps populated ledger rows.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('inbound_email_event_deliveries');
};

// Disable transaction for Citus DB compatibility (create_distributed_table
// cannot run inside a migration transaction).
exports.config = { transaction: false };
