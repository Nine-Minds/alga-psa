/**
 * Add 'processing' status to email_processed_messages check constraint
 * This allows us to mark emails as being processed before publishing events,
 * preventing duplicate processing when Microsoft sends duplicate webhook notifications.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Drop the existing check constraint
  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    DROP CONSTRAINT IF EXISTS email_processed_messages_processing_status_check
  `);

  // Add updated check constraint with 'processing' status
  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    ADD CONSTRAINT email_processed_messages_processing_status_check
    CHECK (processing_status IN ('success', 'failed', 'partial', 'processing'))
  `);

  console.log('✅ Added processing status to email_processed_messages check constraint');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // First update any 'processing' records to 'failed' (they would be stale anyway)
  await knex('email_processed_messages')
    .where('processing_status', 'processing')
    .update({ processing_status: 'failed' });

  // Drop the updated check constraint
  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    DROP CONSTRAINT IF EXISTS email_processed_messages_processing_status_check
  `);

  // Restore original check constraint
  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    ADD CONSTRAINT email_processed_messages_processing_status_check
    CHECK (processing_status IN ('success', 'failed', 'partial'))
  `);

  console.log('✅ Reverted email_processed_messages check constraint');
};
