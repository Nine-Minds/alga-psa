'use strict';

/**
 * Chat ingestion ledger for telephony providers with a live-chat channel (3CX
 * first). Every reported chat lands here keyed by
 * (tenant, provider, provider_chat_id) so a re-delivered ReportChat is
 * idempotent; `interactions` stays the user-facing record.
 */

const CHAT_RECORDS_TABLE = 'telephony_chat_records';

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
  if (!(await knex.schema.hasTable(CHAT_RECORDS_TABLE))) {
    await knex.schema.createTable(CHAT_RECORDS_TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('chat_record_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('provider').notNullable();
      table.text('provider_chat_id').notNullable();
      table.uuid('agent_user_id').nullable();
      table.text('party_number_raw').nullable();
      table.text('party_number_e164').nullable();
      table.text('party_email').nullable();
      table.text('party_name').nullable();
      table.text('queue_extension').nullable();
      table.timestamp('started_at', { useTz: true }).nullable();
      table.timestamp('ended_at', { useTz: true }).nullable();
      table.integer('duration_seconds').nullable();
      table.text('messages').notNullable().defaultTo('');
      table.text('match_status').notNullable().defaultTo('unmatched');
      table.uuid('matched_contact_id').nullable();
      table.uuid('matched_client_id').nullable();
      table.jsonb('match_candidates').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      table.uuid('interaction_id').nullable();
      table.jsonb('raw').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'chat_record_id']);
      table.unique(['tenant', 'provider', 'provider_chat_id'], {
        indexName: 'telephony_chat_records_provider_ref_uk',
      });
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${CHAT_RECORDS_TABLE}_match_status
    ON ${CHAT_RECORDS_TABLE} (tenant, match_status, started_at DESC)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, CHAT_RECORDS_TABLE);

  const fkName = `${CHAT_RECORDS_TABLE}_tenant_foreign`;
  if (!(await constraintExists(knex, CHAT_RECORDS_TABLE, fkName))) {
    await knex.raw(
      `ALTER TABLE ${CHAT_RECORDS_TABLE} ADD CONSTRAINT ${fkName} FOREIGN KEY (tenant) REFERENCES tenants(tenant)`
    );
  }
  // matched_contact_id / matched_client_id / interaction_id are linked by
  // convention, not by FK, so the ledger survives a contact merge or an
  // interaction delete.
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(CHAT_RECORDS_TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
