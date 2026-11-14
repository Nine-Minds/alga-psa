// CM L4b (2 of 5): files attached to shared-work comments, written by an actor of any
// participating organisation. Deliberately NOT a documents/external_files row: documents.created_by
// is an FK to the customer tenant's users, and generic tenant downloads enforce no conversation
// audience. Own storage_path, own content_hash. Squashed: carries the draft link, upload-cleanup
// bookkeeping, removal attribution and disclosure provenance. New table only; Citus-distributed.
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_conversation_attachments';
exports.config = { transaction: false };
exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('attachment_id').notNullable();
    table.uuid('customer_tenant').notNullable(); table.uuid('relationship_id').notNullable();
    // Exactly one parent column is set (see attachmentParent.ts). L4b writes `ticket_id` only; L4c registers `project_task_id`.
    table.uuid('ticket_id').nullable(); table.uuid('project_task_id').nullable();
    table.uuid('thread_id').notNullable(); table.uuid('comment_id').notNullable();
    table.uuid('actor_tenant').notNullable(); table.uuid('actor_user_id').notNullable();
    table.text('file_name').notNullable(); table.string('mime_type', 127).notNullable(); table.integer('file_size').notNullable();
    table.string('content_hash', 64).notNullable(); table.string('request_hash', 64).notNullable(); table.text('storage_path').notNullable();
    table.string('status', 16).notNullable().defaultTo('pending');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('ready_at', { useTz: true }).nullable();
    table.uuid('draft_operation_id').nullable();
    table.timestamp('last_activity_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('discarded_at', { useTz: true }).nullable();
    table.timestamp('purged_at', { useTz: true }).nullable();
    table.timestamp('cleanup_next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.integer('cleanup_attempts').notNullable().defaultTo(0);
    table.string('cleanup_error_code', 64).nullable();
    table.uuid('removal_actor_tenant').nullable(); table.uuid('removal_actor_user_id').nullable();
    table.uuid('disclosure_operation_id').nullable(); table.uuid('disclosure_sponsor_tenant').nullable();
    table.primary(['tenant', 'attachment_id']);
    table.index(['tenant', 'customer_tenant', 'relationship_id', 'ticket_id', 'thread_id', 'comment_id'], 'co_management_attachment_comment_idx');
    table.foreign(['tenant', 'draft_operation_id'], 'co_management_attachment_draft_fk').references(['tenant', 'operation_id']).inTable('co_management_conversation_drafts');
    table.check("(status = 'pending' AND ready_at IS NULL) OR (status = 'ready' AND ready_at IS NOT NULL)");
    table.check('(ticket_id IS NOT NULL) <> (project_task_id IS NOT NULL)', [], 'co_management_attachment_parent_check');
    table.check('file_size BETWEEN 0 AND 26214400');
    table.check("content_hash ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$'");
    table.check('char_length(file_name) BETWEEN 1 AND 255');
    table.check('cleanup_attempts >= 0 AND (purged_at IS NULL OR discarded_at IS NOT NULL)', [], 'co_management_attachment_purge_check');
    table.check(`(removal_actor_tenant IS NULL AND removal_actor_user_id IS NULL) OR
      (removal_actor_tenant IS NOT NULL AND removal_actor_user_id IS NOT NULL AND status = 'ready' AND discarded_at IS NOT NULL
       AND removal_actor_tenant = actor_tenant AND removal_actor_user_id = actor_user_id)`, [], 'co_management_attachment_removal_check');
    table.check(`(disclosure_operation_id IS NULL AND disclosure_sponsor_tenant IS NULL) OR
      (disclosure_operation_id IS NOT NULL AND disclosure_sponsor_tenant IS NOT NULL AND disclosure_sponsor_tenant <> tenant AND status = 'ready' AND draft_operation_id IS NULL)`, [], 'co_management_attachment_disclosure_check');
  });
  await ensureTenantDistribution(knex, TABLE);
  await knex.raw(`CREATE INDEX IF NOT EXISTS co_management_attachment_pending_cleanup_idx ON ?? (tenant, last_activity_at) WHERE status = 'pending' AND draft_operation_id IS NULL AND discarded_at IS NULL`, [TABLE]);
  await knex.raw('CREATE INDEX IF NOT EXISTS co_management_attachment_cleanup_idx ON ?? (tenant, cleanup_next_attempt_at) WHERE discarded_at IS NOT NULL AND purged_at IS NULL', [TABLE]);
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed conversation attachments');
  await knex.schema.dropTableIfExists(TABLE);
};
