/**
 * Create email_processed_attachments for strict attachment idempotency/audit.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('email_processed_attachments');
  if (hasTable) return;

  await knex.schema.createTable('email_processed_attachments', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('provider_id').notNullable();
    table.text('email_id').notNullable();
    table.text('attachment_id').notNullable();

    table.text('processing_status').notNullable().defaultTo('processing');
    table.text('error_message');

    // Results
    table.uuid('file_id');
    table.uuid('document_id');

    // Attachment metadata for troubleshooting/audit
    table.text('file_name');
    table.text('content_type');
    table.bigInteger('file_size');
    table.text('content_id');

    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    // Citus-friendly primary key includes tenant
    table.primary(['tenant', 'provider_id', 'email_id', 'attachment_id']);

    table.check(
      "processing_status IN ('processing','success','failed','skipped')",
      [],
      'email_processed_attachments_processing_status_check'
    );

    table.index(['tenant', 'provider_id']);
    table.index(['tenant', 'processing_status']);
    table.index(['tenant', 'created_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('email_processed_attachments');
};

