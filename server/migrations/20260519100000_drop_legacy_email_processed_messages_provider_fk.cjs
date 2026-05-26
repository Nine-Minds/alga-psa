/**
 * Drop the legacy FK from email_processed_messages to email_provider_configs.
 *
 * email_processed_messages.provider_id now stores ids from email_providers.
 * Keeping the old FK makes IMAP and other unified-provider processing fail
 * unless a matching obsolete email_provider_configs row is manually inserted.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasProcessedMessages = await knex.schema.hasTable('email_processed_messages');
  if (!hasProcessedMessages) return;

  await knex.raw(`
    ALTER TABLE email_processed_messages
    DROP CONSTRAINT IF EXISTS email_processed_messages_provider_id_tenant_foreign
  `);
};

exports.down = async function down() {
  // Intentionally not recreated. The FK points at the obsolete provider table
  // and is incompatible with current provider ids and Citus deployments.
};

exports.config = { transaction: false };
