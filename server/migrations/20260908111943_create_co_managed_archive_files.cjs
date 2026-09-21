const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_archive_files';
exports.up = async knex => {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    for (const field of ['tenant', 'archive_file_id', 'customer_tenant', 'relationship_id', 'client_id', 'source_tenant', 'attachment_id', 'ticket_id', 'thread_id', 'comment_id']) table.uuid(field).notNullable();
    table.primary(['tenant', 'archive_file_id']);
    table.unique(['tenant', 'customer_tenant', 'relationship_id', 'source_tenant', 'attachment_id'], { indexName: 'co_archive_file_source_unique' });
    table.text('audience').notNullable(); table.text('file_name').notNullable(); table.text('mime_type').notNullable();
    table.integer('file_size').notNullable(); table.text('content_hash').notNullable(); table.binary('staged_bytes').nullable();
    table.text('status').notNullable().defaultTo('pending'); table.integer('attempts').notNullable().defaultTo(0);
    table.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('stored_at', { useTz: true }).nullable(); table.text('error_code').nullable();
    table.check("tenant <> customer_tenant AND source_tenant = customer_tenant AND audience IN ('requester', 'shared_it')");
    table.check("file_size BETWEEN 0 AND 26214400 AND content_hash ~ '^[0-9a-f]{64}$' AND char_length(file_name) BETWEEN 1 AND 255 AND char_length(mime_type) BETWEEN 1 AND 127");
    table.check("(status = 'pending' AND staged_bytes IS NOT NULL AND octet_length(staged_bytes) = file_size AND stored_at IS NULL) OR (status = 'ready' AND staged_bytes IS NULL AND stored_at IS NOT NULL)");
    table.index(['tenant', 'status', 'next_attempt_at'], 'co_archive_file_pending_idx');
  });
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex('pg_constraint').where('conname', 'co_archive_file_owner_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first())
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant'], 'co_archive_file_owner_fk').references(['tenant']).inTable('tenants'));
  const immutable = ['tenant', 'archive_file_id', 'customer_tenant', 'relationship_id', 'client_id', 'source_tenant', 'attachment_id', 'ticket_id', 'thread_id', 'comment_id',
    'audience', 'file_name', 'mime_type', 'file_size', 'content_hash', 'captured_at'];
  // Compare metadata directly; converting a 25 MB staging buffer to JSON on every retry would multiply its memory footprint.
  await knex.raw(`CREATE OR REPLACE FUNCTION co_archive_file_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF ROW(${immutable.map(field => `NEW.${field}`).join(', ')}) IS DISTINCT FROM ROW(${immutable.map(field => `OLD.${field}`).join(', ')}) OR
       (OLD.status = 'ready' AND NEW IS DISTINCT FROM OLD) OR
       (NEW.status = 'pending' AND NEW.staged_bytes IS DISTINCT FROM OLD.staged_bytes)
    THEN RAISE EXCEPTION 'Retained archive file identity and content are immutable' USING ERRCODE = '23514'; END IF;
    RETURN NEW; END; $$`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw(`DROP TRIGGER IF EXISTS co_archive_file_immutable ON ${TABLE}`);
    await knex.raw(`CREATE TRIGGER co_archive_file_immutable BEFORE UPDATE ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION co_archive_file_immutable()`);
  }
};
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained archive files');
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS co_archive_file_immutable()');
};
exports.config = { transaction: false };
