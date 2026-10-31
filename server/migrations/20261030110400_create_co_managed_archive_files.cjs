// CM L4b (5 of 5): copy-on-retain archive file rows (substrate only; L7a chooses what is retained).
// Owned by the sponsor tenant, survives the customer's deletion. Identity/content immutability is
// enforced in archiveFiles.ts, not by a trigger (PLAN §3). New table only; Citus-distributed.
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_archive_files';
exports.config = { transaction: false };
exports.up = async knex => {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    for (const field of ['tenant', 'archive_file_id', 'customer_tenant', 'relationship_id', 'client_id', 'source_tenant', 'attachment_id', 'thread_id', 'comment_id']) table.uuid(field).notNullable();
    table.uuid('ticket_id').nullable(); table.uuid('project_task_id').nullable();
    table.primary(['tenant', 'archive_file_id']);
    table.unique(['tenant', 'customer_tenant', 'relationship_id', 'source_tenant', 'attachment_id'], { indexName: 'co_archive_file_source_unique' });
    table.text('audience').notNullable(); table.text('file_name').notNullable(); table.text('mime_type').notNullable();
    table.integer('file_size').notNullable(); table.text('content_hash').notNullable(); table.binary('staged_bytes').nullable();
    table.text('status').notNullable().defaultTo('pending'); table.integer('attempts').notNullable().defaultTo(0);
    table.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('stored_at', { useTz: true }).nullable(); table.text('error_code').nullable();
    table.check('(ticket_id IS NOT NULL) <> (project_task_id IS NOT NULL)', [], 'co_archive_file_parent_check');
    table.check("tenant <> customer_tenant AND source_tenant = customer_tenant AND audience IN ('requester', 'shared_it')");
    table.check("file_size BETWEEN 0 AND 26214400 AND content_hash ~ '^[0-9a-f]{64}$' AND char_length(file_name) BETWEEN 1 AND 255 AND char_length(mime_type) BETWEEN 1 AND 127");
    table.check("(status = 'pending' AND staged_bytes IS NOT NULL AND octet_length(staged_bytes) = file_size AND stored_at IS NULL) OR (status = 'ready' AND staged_bytes IS NULL AND stored_at IS NOT NULL)");
    table.index(['tenant', 'status', 'next_attempt_at'], 'co_archive_file_pending_idx');
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained archive files');
  await knex.schema.dropTableIfExists(TABLE);
};
