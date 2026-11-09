/**
 * TC L0c: owner-qualified conversation file engine (@alga-psa/conversations).
 *
 * Two NEW tables, expand-only (nothing existing is altered; old code never reads them):
 *  - conversation_file_publications: one receipt per publication operation
 *    (prepared -> published | abandoned), bound to a request hash.
 *  - conversation_files: one row per stored object, qualified by (owner_type, owner_id).
 *    conversation_id is NULL until the conversation container exists (L1).
 * Deliberately NOT documents/external_files rows: generic document downloads enforce no
 * audience. Authorization comes from the owner-adapter registry in the package.
 *
 * Citus: both tables are tenant-distributed, colocated with `tenants`. `tenant` is in every
 * PK and in the one FK. There are no unique indexes besides the PKs. No now() in UPDATE;
 * the engine binds timestamps. Idempotent; `down` refuses to drop non-empty tables.
 */
const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

const FILES = 'conversation_files';
const PUBLICATIONS = 'conversation_file_publications';
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(PUBLICATIONS))) {
    await knex.schema.createTable(PUBLICATIONS, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('operation_id').notNullable();
      table.text('owner_type').notNullable();
      table.uuid('owner_id').notNullable();
      table.uuid('conversation_id').nullable();
      table.uuid('actor_user_id').notNullable();
      table.string('request_hash', 64).notNullable();
      table.string('status', 16).notNullable().defaultTo('prepared');
      table.timestamp('prepared_at', { useTz: true }).notNullable();
      table.timestamp('published_at', { useTz: true }).nullable();
      table.timestamp('abandoned_at', { useTz: true }).nullable();
      table.jsonb('manifest').notNullable();
      table.timestamp('last_activity_at', { useTz: true }).notNullable();
      table.timestamp('cleanup_completed_at', { useTz: true }).nullable();
      table.primary(['tenant', 'operation_id']);
      table.index(['tenant', 'owner_type', 'owner_id'], 'conversation_file_publications_owner_idx');
      table.index(['tenant', 'status', 'last_activity_at'], 'conversation_file_publications_activity_idx');
      table.check("owner_type ~ '^[a-z][a-z0-9_]{0,63}$'", [], 'conversation_file_publications_owner_type_check');
      table.check("request_hash ~ '^[0-9a-f]{64}$'", [], 'conversation_file_publications_hash_check');
      table.check(
        `(status = 'prepared' AND published_at IS NULL AND abandoned_at IS NULL)
         OR (status = 'published' AND published_at IS NOT NULL AND abandoned_at IS NULL)
         OR (status = 'abandoned' AND abandoned_at IS NOT NULL AND published_at IS NULL)`,
        [], 'conversation_file_publications_status_check');
      table.check("jsonb_typeof(manifest) = 'array' AND jsonb_array_length(manifest) BETWEEN 1 AND 20", [], 'conversation_file_publications_manifest_check');
      table.check('cleanup_completed_at IS NULL OR abandoned_at IS NOT NULL', [], 'conversation_file_publications_cleanup_check');
    });
  }
  await ensureTenantDistribution(knex, PUBLICATIONS);

  if (!(await knex.schema.hasTable(FILES))) {
    await knex.schema.createTable(FILES, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('file_id').notNullable();
      table.text('owner_type').notNullable();
      table.uuid('owner_id').notNullable();
      table.uuid('conversation_id').nullable();
      table.uuid('actor_user_id').notNullable();
      table.text('file_name').notNullable();
      table.string('mime_type', 127).notNullable();
      table.integer('file_size').notNullable();
      table.string('content_hash', 64).notNullable();
      table.string('request_hash', 64).notNullable();
      table.text('storage_path').notNullable();
      table.string('status', 16).notNullable().defaultTo('pending');
      table.timestamp('ready_at', { useTz: true }).nullable();
      table.uuid('publication_operation_id').nullable();
      table.uuid('source_file_id').nullable();
      table.timestamp('last_activity_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('discarded_at', { useTz: true }).nullable();
      table.timestamp('purged_at', { useTz: true }).nullable();
      table.integer('cleanup_attempts').notNullable().defaultTo(0);
      table.timestamp('cleanup_next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.string('cleanup_error_code', 64).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'file_id']);
      table.index(['tenant', 'owner_type', 'owner_id'], 'conversation_files_owner_idx');
      table.index(['tenant', 'publication_operation_id'], 'conversation_files_publication_idx');
      table.index(['tenant', 'discarded_at', 'purged_at', 'cleanup_next_attempt_at'], 'conversation_files_cleanup_idx');
      table.check("owner_type ~ '^[a-z][a-z0-9_]{0,63}$'", [], 'conversation_files_owner_type_check');
      table.check("(status = 'pending' AND ready_at IS NULL) OR (status = 'ready' AND ready_at IS NOT NULL)", [], 'conversation_files_status_check');
      table.check('file_size BETWEEN 0 AND 26214400', [], 'conversation_files_size_check');
      table.check("content_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'", [], 'conversation_files_hash_check');
      table.check('char_length(file_name) BETWEEN 1 AND 255', [], 'conversation_files_name_check');
      table.check('cleanup_attempts >= 0 AND (purged_at IS NULL OR discarded_at IS NOT NULL)', [], 'conversation_files_purge_check');
    });
  }
  await ensureTenantDistribution(knex, FILES);

  // Added after both tables have their final distribution; tenant leads the key.
  await ensureCompositeFk(knex, {
    table: FILES,
    constraint: 'conversation_files_publication_fk',
    columns: ['tenant', 'publication_operation_id'],
    referencedTable: PUBLICATIONS,
    referencedColumns: ['tenant', 'operation_id'],
  });
};

exports.down = async function down(knex) {
  for (const table of [FILES, PUBLICATIONS]) {
    if ((await knex.schema.hasTable(table)) && (await knex(table).first())) throw new Error(`Cannot discard retained ${table} rows`);
  }
  await knex.schema.dropTableIfExists(FILES);
  await knex.schema.dropTableIfExists(PUBLICATIONS);
};
