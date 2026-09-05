'use strict';

/**
 * Call recording/transcript artifacts (F066).
 *
 * Teams Phone publishes recordings and transcripts on the ad hoc call resource
 * minutes after the call ends, so the ledger row needs its own fetch state
 * (`artifact_status` / `artifact_fetch_attempts` / `last_artifact_fetch_at`)
 * exactly like `online_meetings` carries for meeting recordings.
 *
 * `telephony_call_artifacts` is the per-artifact join to what we persisted:
 * a document for a transcript, a stored file for a recording. Keyed by
 * (tenant, call_record_id, artifact_type, provider_artifact_id) so a repeated
 * poll re-links instead of duplicating.
 */

const CALL_RECORDS_TABLE = 'telephony_call_records';
const ARTIFACTS_TABLE = 'telephony_call_artifacts';

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
  const hasArtifactStatus = await knex.schema.hasColumn(CALL_RECORDS_TABLE, 'artifact_status');
  if (!hasArtifactStatus) {
    await knex.schema.alterTable(CALL_RECORDS_TABLE, (table) => {
      table.text('artifact_status').notNullable().defaultTo('pending');
      table.integer('artifact_fetch_attempts').notNullable().defaultTo(0);
      table.timestamp('last_artifact_fetch_at', { useTz: true }).nullable();
    });
  }

  if (!(await knex.schema.hasTable(ARTIFACTS_TABLE))) {
    await knex.schema.createTable(ARTIFACTS_TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('artifact_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('call_record_id').notNullable();
      table.text('artifact_type').notNullable();
      table.text('provider_artifact_id').notNullable();
      table.text('content_url').nullable();
      table.uuid('document_id').nullable();
      table.uuid('file_id').nullable();
      table.timestamp('created_date_time', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'artifact_id']);
      table.unique(['tenant', 'call_record_id', 'artifact_type', 'provider_artifact_id'], {
        indexName: 'telephony_call_artifacts_provider_ref_uk',
      });
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${ARTIFACTS_TABLE}_call_record
    ON ${ARTIFACTS_TABLE} (tenant, call_record_id)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${CALL_RECORDS_TABLE}_artifact_status
    ON ${CALL_RECORDS_TABLE} (tenant, artifact_status, ended_at DESC)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, ARTIFACTS_TABLE);

  await addForeignKey(knex, ARTIFACTS_TABLE, `${ARTIFACTS_TABLE}_tenant_foreign`,
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');
  // document_id / file_id are linked by convention, like the ledger's own
  // interaction/ticket columns: deleting a document must not delete the record
  // of the call that produced it.
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(ARTIFACTS_TABLE);
  const hasArtifactStatus = await knex.schema.hasColumn(CALL_RECORDS_TABLE, 'artifact_status');
  if (hasArtifactStatus) {
    await knex.schema.alterTable(CALL_RECORDS_TABLE, (table) => {
      table.dropColumn('artifact_status');
      table.dropColumn('artifact_fetch_attempts');
      table.dropColumn('last_artifact_fetch_at');
    });
  }
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };
