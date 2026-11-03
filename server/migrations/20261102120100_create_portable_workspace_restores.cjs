/**
 * Co-managed IT L7b2: portable restore receipts (new table only).
 *
 * One receipt per restored tenant. state machine: staged -> promoted -> verified,
 * enforced in application code (no triggers; Citus skips them). No foreign keys.
 * Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'portable_workspace_restores';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('source_tenant').notNullable();
      table.uuid('package_id').notNullable();
      table.text('archive_sha256').notNullable();
      table.text('state').notNullable().defaultTo('staged');
      table.uuid('source_administrator_user_id').nullable();
      table.uuid('administrator_user_id').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('promoted_at', { useTz: true }).nullable();
      table.timestamp('verified_at', { useTz: true }).nullable();
      table.primary(['tenant']);
      table.check("state IN ('staged', 'promoted', 'verified')");
      table.check("archive_sha256 ~ '^[0-9a-f]{64}$'");
      table.check("(state = 'staged') OR promoted_at IS NOT NULL");
      table.check("(state <> 'verified') OR verified_at IS NOT NULL");
    });
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove retained portable restore receipts');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
