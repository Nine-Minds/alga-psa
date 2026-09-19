/**
 * Add 'skipped' status to email_processed_messages check constraint.
 * Inbound email rules can suppress ticket creation entirely (e.g. status-update
 * emails); those messages are recorded with processing_status = 'skipped' and
 * rule metadata so the outcome stays auditable in email diagnostics.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    DROP CONSTRAINT IF EXISTS email_processed_messages_processing_status_check
  `);

  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    ADD CONSTRAINT email_processed_messages_processing_status_check
    CHECK (processing_status IN ('success', 'failed', 'partial', 'processing', 'skipped'))
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Reclassify 'skipped' records before restoring the narrower constraint.
  await knex('email_processed_messages')
    .where('processing_status', 'skipped')
    .update({ processing_status: 'success' });

  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    DROP CONSTRAINT IF EXISTS email_processed_messages_processing_status_check
  `);

  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    ADD CONSTRAINT email_processed_messages_processing_status_check
    CHECK (processing_status IN ('success', 'failed', 'partial', 'processing'))
  `);
};
