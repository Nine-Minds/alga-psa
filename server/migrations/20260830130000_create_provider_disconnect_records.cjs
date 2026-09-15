const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

/**
 * Migration: create provider_disconnect_records — the durable, per-provider
 * disconnect state machine for QBO and Xero.
 *
 * One row per (tenant, provider). The record tracks per-target (realm /
 * connection) revocation progress and drives retry: `pending_revocation` means
 * provider-side cleanup still owes work (retryable), `failed_permanent` needs
 * an operator's explicit force-finalize, and `finalized` means provider cleanup
 * was confirmed and local credentials are gone. Disconnect started tombstoning
 * credentials immediately, so the existence of a non-finalized row is what
 * gates the sync/export credential-load path.
 *
 * Targets are stored as a jsonb array so multi-realm / multi-connection
 * partial completion is surfaced per target without a second table. The only
 * credential-adjacent material kept here is target ids and sanitized error
 * classes — never tokens.
 */
const TABLE = 'provider_disconnect_records';

const VALID_RECORD_STATUSES = ['pending_revocation', 'failed_permanent', 'finalized'];

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('record_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.string('provider', 50).notNullable(); // quickbooks_online | xero
      table.string('status', 30).notNullable().defaultTo('pending_revocation');
      table.jsonb('targets').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.timestamp('next_retry_at', { useTz: true }).nullable();
      table.string('last_error_class', 100).nullable();
      table.string('correlation_id', 64).nullable();
      table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('finalized_at', { useTz: true }).nullable();
      table.string('finalize_reason', 255).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'provider']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      table.index(['tenant', 'status', 'next_retry_at'], 'provider_disconnect_records_retry_idx');
    });
  }

  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS provider_disconnect_records_status_check`);
  await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT provider_disconnect_records_status_check CHECK (status IN (${VALID_RECORD_STATUSES.map((s) => `'${s}'`).join(', ')}))`);

  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS provider_disconnect_records_provider_check`);
  await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT provider_disconnect_records_provider_check CHECK (provider IN ('quickbooks_online', 'xero'))`);

  await ensureTenantDistribution(knex, TABLE);

  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.schema.raw(`GRANT ALL PRIVILEGES ON TABLE ${TABLE} TO "${escapedUser}"`);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };
