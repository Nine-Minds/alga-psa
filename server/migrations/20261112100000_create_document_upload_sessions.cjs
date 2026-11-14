'use strict';

/**
 * document_upload_sessions — resumable, chunked document uploads (alga-2026-0002891).
 *
 * One row per upload. The row is the durable state of a provider write session: the opaque
 * provider handle, the receipts of the parts written so far and `committed_offset`, the number of
 * bytes durably stored. Chunks are accepted only at `committed_offset`, and every status change is
 * a conditional UPDATE (`WHERE status = <expected>`), so a double complete or two racing chunks
 * resolve in the database, not in a process.
 *
 * Citus: new table, no pre-existing rows. The primary key and every index lead with the
 * distribution column (`tenant`); composite foreign keys are added after distribution.
 * The sweeper's "expired and still open" scan is served by the (tenant, status, expires_at) index.
 */

const TABLE = 'document_upload_sessions';
const SWEEP_INDEX = 'document_upload_sessions_tenant_status_expires_idx';
const UPLOADER_INDEX = 'document_upload_sessions_tenant_uploader_idx';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('session_id').notNullable();

      table.uuid('uploaded_by').notNullable();

      table.text('entity_type').notNullable();
      table.uuid('entity_id').notNullable();
      // Upload options that shape the document (draft attachment, folder, visibility).
      table.jsonb('target_options').notNullable().defaultTo('{}');

      table.text('file_name').notNullable();
      table.text('mime_type').notNullable();
      table.bigInteger('declared_size').notNullable();

      // Plain-JSON provider write-session handle (bucket/key/uploadId or local paths) and final path.
      table.jsonb('write_handle').notNullable();
      table.text('storage_path').notNullable();

      table.integer('chunk_size').notNullable();
      table.bigInteger('committed_offset').notNullable().defaultTo(0);
      // PartReceipt[]: part number, ETag (or equivalent), size, final flag.
      table.jsonb('parts').notNullable().defaultTo('[]');

      // The one chunk request allowed to write at committed_offset right now. A chunk claims the
      // session before writing and commits against its token; the lease lapses if the request dies.
      table.uuid('chunk_claim_token').nullable();
      table.timestamp('chunk_claim_expires_at', { useTz: true }).nullable();

      table.text('status').notNullable().defaultTo('active');
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.uuid('document_id').nullable();

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'session_id']);
    });
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT document_upload_sessions_status_check
      CHECK (status IN ('active', 'completing', 'completed', 'aborted', 'expired'))
    `);
    await knex.raw(`
      ALTER TABLE ${TABLE}
      ADD CONSTRAINT document_upload_sessions_offset_check
      CHECK (committed_offset >= 0 AND committed_offset <= declared_size AND declared_size >= 0)
    `);
  }

  const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);

  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ${SWEEP_INDEX}
    ON ${TABLE} (tenant, status, expires_at)
  `);
  await knex.raw(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS ${UPLOADER_INDEX}
    ON ${TABLE} (tenant, uploaded_by, created_at)
  `);

  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_uploader_foreign`,
    columns: ['tenant', 'uploaded_by'],
    referencedTable: 'users',
    referencedColumns: ['tenant', 'user_id'],
    onDelete: 'CASCADE',
  });
  await ensureCompositeFk(knex, {
    table: TABLE,
    constraint: `${TABLE}_document_foreign`,
    columns: ['tenant', 'document_id'],
    referencedTable: 'documents',
    referencedColumns: ['tenant', 'document_id'],
    onDelete: 'CASCADE',
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table and CREATE INDEX CONCURRENTLY cannot run inside a transaction.
exports.config = { transaction: false };
