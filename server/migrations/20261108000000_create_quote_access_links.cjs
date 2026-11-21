/**
 * Per-recipient access links for quotes (email-link quote approval).
 *
 * Only the SHA-256 hash of the 256-bit token is stored (token_hash, lowercase
 * hex). There is deliberately NO raw token column.
 *
 * idx_quote_access_links_token_hash is the single tenantless lookup: the public
 * link does not know its tenant, so the service resolves hash -> tenant with it
 * and does every other read/write with tenant scope.
 *
 * Citus: `quotes` is NOT distributed (a plain/Citus-local table, like
 * quote_activities), and Citus rejects a distributed table with an FK to a
 * non-distributed one. So this table is distributed on `tenant` only when
 * `quotes` is itself distributed; otherwise it stays alongside `quotes` so the
 * (tenant, quote_id) FK remains valid. Because FK CASCADE is not reliable across
 * that boundary, Quote.delete also deletes these rows explicitly.
 */
async function isDistributed(knex, tableName) {
  const citusFn = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS exists"
  );
  if (!citusFn.rows?.[0]?.exists) return { citus: false, distributed: false };
  const { rows } = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS d",
    [tableName]
  );
  return { citus: true, distributed: Boolean(rows?.[0]?.d) };
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('quote_access_links'))) {
    await knex.schema.createTable('quote_access_links', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('link_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('quote_id').notNullable();
      table.uuid('contact_id');
      table.text('recipient_email').notNullable();
      table.specificType('token_hash', 'char(64)').notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('revoked_at', { useTz: true });
      table.text('revoked_reason');
      table.timestamp('last_used_at', { useTz: true });
      table.integer('use_count').notNullable().defaultTo(0);
      table.uuid('created_by');
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'link_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table
        .foreign(['tenant', 'quote_id'], 'fk_quote_access_links_quote')
        .references(['tenant', 'quote_id'])
        .inTable('quotes')
        .onDelete('CASCADE');

      table.unique(['tenant', 'token_hash'], 'uq_quote_access_links_token_hash');
      table.index(['tenant', 'quote_id', 'revoked_at'], 'idx_quote_access_links_tenant_quote_revoked');
      // Tenantless lookup (hash -> tenant only).
      table.index(['token_hash'], 'idx_quote_access_links_token_hash');
    });
  }

  const quotes = await isDistributed(knex, 'quotes');
  if (quotes.citus && quotes.distributed) {
    const self = await isDistributed(knex, 'quote_access_links');
    if (!self.distributed) {
      await knex.raw("SELECT create_distributed_table('quote_access_links', 'tenant')");
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('quote_access_links');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
