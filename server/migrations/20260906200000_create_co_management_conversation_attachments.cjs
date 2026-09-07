const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_conversation_attachments';
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('attachment_id').notNullable();
    table.uuid('customer_tenant').notNullable(); table.uuid('relationship_id').notNullable(); table.uuid('ticket_id').notNullable();
    table.uuid('thread_id').notNullable(); table.uuid('comment_id').notNullable();
    table.uuid('actor_tenant').notNullable(); table.uuid('actor_user_id').notNullable();
    table.text('file_name').notNullable(); table.string('mime_type', 127).notNullable(); table.integer('file_size').notNullable();
    table.string('content_hash', 64).notNullable(); table.string('request_hash', 64).notNullable(); table.text('storage_path').notNullable();
    table.string('status', 16).notNullable().defaultTo('pending');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('ready_at', { useTz: true }).nullable();
    table.primary(['tenant', 'attachment_id']);
    table.index(['tenant', 'customer_tenant', 'relationship_id', 'ticket_id', 'thread_id', 'comment_id'], 'co_management_attachment_comment_idx');
    table.check("(status = 'pending' AND ready_at IS NULL) OR (status = 'ready' AND ready_at IS NOT NULL)");
    table.check('file_size BETWEEN 0 AND 26214400');
    table.check("content_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'");
    table.check('char_length(file_name) BETWEEN 1 AND 255');
    // Both canonical and home-private comments are qualified soft references.
    // These objects deliberately have no generic external_files/document entry:
    // generic tenant downloads do not enforce a conversation audience.
  });
  await ensureTenantDistribution(knex, TABLE);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed conversation attachments');
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };
