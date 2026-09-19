/**
 * Creates the document sharing system: share links and access logging.
 *
 * Combines:
 *  - create_document_share_links_table
 *  - create_document_share_access_log_table
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

// On fresh Citus chains the documents subsystem was never converted:
// document_share_links FKs documents, so documents and its FK parents must
// be distributed first. shared_document_types (tenant-less catalog) must be
// a reference table, but converting it would drag local documents — which
// FKs distributed users — into the conversion, so the cross-FK is dropped
// and re-added around the conversions (distributed -> reference is allowed).
// No-op on plain Postgres and on clusters already converted.
async function ensureDocumentsDistributed(knex) {
  const citusFn = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS exists"
  );
  if (!citusFn.rows?.[0]?.exists) return;

  const isReference = async (table) => {
    const { rows } = await knex.raw(
      "SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass AND partmethod = 'n' AND repmodel = 't'",
      [table]
    );
    return rows.length > 0;
  };

  const sharedTypesPending = !(await isReference('shared_document_types'));
  const documentsPending = await knex.raw(
    "SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'documents'::regclass AND partmethod = 'h'"
  ).then(({ rows }) => rows.length === 0);

  for (const t of ['storage_providers', 'storage_configurations', 'document_types', 'external_files']) {
    await distributeIfCitus(knex, t);
  }

  if (sharedTypesPending || documentsPending) {
    const { rows: crossFks } = await knex.raw(`
      SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid = 'documents'::regclass
        AND confrelid = 'shared_document_types'::regclass
    `);
    for (const fk of crossFks) {
      await knex.raw(`ALTER TABLE ${fk.tbl} DROP CONSTRAINT "${fk.conname}"`);
    }
    if (sharedTypesPending) {
      await knex.raw("SELECT create_reference_table('shared_document_types')");
    }
    await distributeIfCitus(knex, 'documents');
    for (const fk of crossFks) {
      await knex.raw(`ALTER TABLE ${fk.tbl} ADD CONSTRAINT "${fk.conname}" ${fk.def}`);
    }
  }
}

exports.up = async function up(knex) {
  await ensureDocumentsDistributed(knex);

  // --- Step 1: Create document_share_links ---
  if (!(await knex.schema.hasTable('document_share_links'))) {
    await knex.schema.createTable('document_share_links', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('share_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('document_id').notNullable();

      // Token is a 256-bit (32 byte) random value, stored as base64 (43 chars + padding)
      table.text('token').notNullable();

      // Share type: 'public' | 'password' | 'portal_authenticated'
      table.text('share_type').notNullable().defaultTo('public');

      // Password hash (bcrypt) - only used when share_type = 'password'
      table.text('password_hash');

      // Expiry and limits
      table.timestamp('expires_at', { useTz: true });
      table.integer('max_downloads');
      table.integer('download_count').notNullable().defaultTo(0);

      // Revocation
      table.boolean('is_revoked').notNullable().defaultTo(false);
      table.timestamp('revoked_at', { useTz: true });
      table.uuid('revoked_by');

      // Audit columns
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');

      table.primary(['tenant', 'share_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'document_id']).references(['tenant', 'document_id']).inTable('documents');

      // Index for token lookup (public access doesn't know tenant)
      table.index(['token'], 'idx_doc_share_links_token');
      // Index for listing shares per document
      table.index(['tenant', 'document_id', 'is_revoked'], 'idx_doc_share_links_tenant_document_revoked');
      // Unique constraint on token (includes tenant for CitusDB distribution compatibility)
      table.unique(['tenant', 'token'], 'uq_doc_share_links_token');
    });
  }

  await distributeIfCitus(knex, 'document_share_links');

  // --- Step 2: Create document_share_access_log ---
  if (!(await knex.schema.hasTable('document_share_access_log'))) {
    await knex.schema.createTable('document_share_access_log', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('access_log_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('share_id').notNullable();

      // Access details
      table.timestamp('accessed_at', { useTz: true }).defaultTo(knex.fn.now());
      table.text('ip_address');
      table.text('user_agent');
      table.uuid('user_id'); // Only set for portal_authenticated shares

      // Access type: 'view' | 'download' | 'info'
      table.text('access_type').notNullable().defaultTo('download');

      // Whether access was successful or denied (e.g., wrong password, expired)
      table.boolean('was_successful').notNullable().defaultTo(true);
      table.text('failure_reason');

      table.primary(['tenant', 'access_log_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'share_id']).references(['tenant', 'share_id']).inTable('document_share_links');

      // Index for querying access history per share
      table.index(['tenant', 'share_id', 'accessed_at'], 'idx_doc_share_access_log_share_time');
    });
  }

  await distributeIfCitus(knex, 'document_share_access_log');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_share_access_log');
  await knex.schema.dropTableIfExists('document_share_links');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
