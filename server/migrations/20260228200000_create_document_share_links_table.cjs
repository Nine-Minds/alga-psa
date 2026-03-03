/**
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

exports.up = async function up(knex) {
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
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_share_links');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
