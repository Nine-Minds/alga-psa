'use strict';

/**
 * Telephony integration class — provider config + call ingestion ledger
 * (F013–F015).
 *
 * `telephony_providers` holds one row per configured provider (teams-phone
 * first, Twilio/Ringotel later) with its change-notification subscription
 * state, so a second provider is a row rather than a schema change.
 *
 * `telephony_call_records` is the ingestion ledger: every CDR we accept lands
 * here keyed by (tenant, provider, provider_call_id) so replayed webhook
 * notifications are idempotent. `interactions` stays the user-facing record;
 * this table is what we re-run matching from.
 */

const PROVIDERS_TABLE = 'telephony_providers';
const CALL_RECORDS_TABLE = 'telephony_call_records';

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

async function addForeignKey(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(PROVIDERS_TABLE))) {
    await knex.schema.createTable(PROVIDERS_TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('provider_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('provider').notNullable();
      table.text('status').notNullable().defaultTo('not_configured');
      table.jsonb('config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.boolean('auto_create_tickets').notNullable().defaultTo(false);
      table.text('subscription_id').nullable();
      table.timestamp('subscription_expires_at', { useTz: true }).nullable();
      table.text('webhook_secret').nullable();
      table.text('last_error').nullable();
      table.timestamp('last_notification_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'provider_id']);
      table.unique(['tenant', 'provider'], { indexName: 'telephony_providers_tenant_provider_uk' });
    });
  }

  if (!(await knex.schema.hasTable(CALL_RECORDS_TABLE))) {
    await knex.schema.createTable(CALL_RECORDS_TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('call_record_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('provider').notNullable();
      table.text('provider_call_id').notNullable();
      table.text('direction').notNullable();
      table.text('caller_number_raw').nullable();
      table.text('caller_number_e164').nullable();
      table.text('callee_number_raw').nullable();
      table.text('callee_number_e164').nullable();
      table.text('organizer_user_id').nullable();
      table.text('modality').nullable();
      table.timestamp('started_at', { useTz: true }).nullable();
      table.timestamp('ended_at', { useTz: true }).nullable();
      table.integer('duration_seconds').nullable();
      table.text('match_status').notNullable().defaultTo('unmatched');
      table.uuid('matched_contact_id').nullable();
      table.uuid('matched_client_id').nullable();
      table.jsonb('match_candidates').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
      table.uuid('interaction_id').nullable();
      table.uuid('ticket_id').nullable();
      table.jsonb('raw').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'call_record_id']);
      table.unique(['tenant', 'provider', 'provider_call_id'], {
        indexName: 'telephony_call_records_provider_ref_uk',
      });
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${CALL_RECORDS_TABLE}_match_status
    ON ${CALL_RECORDS_TABLE} (tenant, match_status, started_at DESC)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${CALL_RECORDS_TABLE}_started_at
    ON ${CALL_RECORDS_TABLE} (tenant, started_at DESC)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, PROVIDERS_TABLE);
  await ensureTenantDistribution(knex, CALL_RECORDS_TABLE);

  await addForeignKey(knex, PROVIDERS_TABLE, `${PROVIDERS_TABLE}_tenant_foreign`,
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  await addForeignKey(knex, CALL_RECORDS_TABLE, `${CALL_RECORDS_TABLE}_tenant_foreign`,
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  // matched_contact_id / matched_client_id / interaction_id / ticket_id are
  // linked by convention, not by FK: the ledger must survive a contact merge or
  // an interaction delete without losing the call it captured.
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(CALL_RECORDS_TABLE);
  await knex.schema.dropTableIfExists(PROVIDERS_TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
