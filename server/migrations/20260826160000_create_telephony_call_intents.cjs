'use strict';

/**
 * Short-lived outbound call intents bridge a ticket-screen Teams deep link to
 * the call record Graph delivers after the call. They are deliberately kept
 * separate from the call ledger: clicking Call is an intent, not proof that a
 * call connected.
 */

const TABLE_NAME = 'telephony_call_intents';

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE_NAME))) {
    await knex.schema.createTable(TABLE_NAME, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('intent_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('provider').notNullable().defaultTo('teams-phone');
      table.uuid('user_id').notNullable();
      table.text('provider_user_id').nullable();
      table.uuid('ticket_id').notNullable();
      table.uuid('client_id').nullable();
      table.uuid('contact_id').nullable();
      table.text('phone_number_raw').notNullable();
      table.text('phone_number_e164').notNullable();
      table.text('status').notNullable().defaultTo('pending');
      table.uuid('call_record_id').nullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('matched_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'intent_id']);
    });
  }

  if (!(await constraintExists(knex, TABLE_NAME, `${TABLE_NAME}_status_check`))) {
    await knex.raw(`
      ALTER TABLE ${TABLE_NAME}
      ADD CONSTRAINT ${TABLE_NAME}_status_check
      CHECK (status IN ('pending', 'matched', 'expired', 'cancelled'))
    `);
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_pending_number
    ON ${TABLE_NAME} (tenant, provider, phone_number_e164, created_at DESC)
    WHERE status = 'pending'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE_NAME}_expiry
    ON ${TABLE_NAME} (tenant, status, expires_at)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE_NAME);

  if (!(await constraintExists(knex, TABLE_NAME, `${TABLE_NAME}_tenant_foreign`))) {
    await knex.raw(`
      ALTER TABLE ${TABLE_NAME}
      ADD CONSTRAINT ${TABLE_NAME}_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant)
    `);
  }

  // Ticket/contact/client/user/call-record references are kept by convention.
  // An intent must remain auditable if one of those operational records is
  // merged or removed before the delayed Graph call record arrives.
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
