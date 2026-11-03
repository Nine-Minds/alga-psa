/**
 * Co-managed IT L7a: relationship closure receipts (new table only).
 *
 * `UNIQUE (tenant, relationship_id)` IS the exactly-once guarantee: a relationship
 * closes once, whoever retries (action, workflow, operator). The row is MSP-owned
 * (`tenant` = sponsor) so it survives deletion of the customer. No foreign keys, no
 * triggers: immutability is enforced in app code (Citus skips triggers). Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'co_managed_relationship_closures';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable(); // Sponsoring MSP.
      table.uuid('operation_id').notNullable();
      table.uuid('customer_tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.uuid('actor_tenant').notNullable();
      table.uuid('actor_user_id').notNullable();
      table.text('request_fingerprint').notNullable();
      table.text('reason').notNullable();
      table.integer('applied_revision').notNullable();
      table.integer('released_seats').notNullable();
      table.timestamp('cutoff_at', { useTz: true }).notNullable();
      table.timestamp('closed_at', { useTz: true }).notNullable();
      table.primary(['tenant', 'operation_id']);
      table.unique(['tenant', 'relationship_id'], { indexName: 'co_relationship_closure_once' });
      table.check('tenant <> customer_tenant');
      table.check('actor_tenant IN (tenant, customer_tenant)');
      table.check("reason IN ('departure', 'independent_upgrade')");
      table.check("request_fingerprint ~ '^[0-9a-f]{64}$'");
      table.check('applied_revision > 0 AND released_seats >= 0 AND cutoff_at <= closed_at');
    });
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove retained co-management closure receipts');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
