/**
 * Drop the legacy FK constraint from email_processed_messages → email_provider_configs.
 *
 * The current inbound email model uses distributed tables (Citus) where FKs are often unsupported,
 * and provider records live in email_providers/vendor config tables. This FK can block inserts and
 * prevent webhook processing entirely when email_provider_configs is empty/obsolete.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasProcessed = await knex.schema.hasTable('email_processed_messages');
  if (!hasProcessed) {
    console.warn('[drop_email_processed_messages_provider_fk] email_processed_messages table not found; skipping');
    return;
  }

  await knex.schema.raw(`
    ALTER TABLE email_processed_messages
    DROP CONSTRAINT IF EXISTS email_processed_messages_provider_id_tenant_foreign
  `);

  console.log('✅ Dropped email_processed_messages_provider_id_tenant_foreign (if present)');
};

/**
 * Best-effort down migration: only re-add the original FK if the referenced table exists.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasProcessed = await knex.schema.hasTable('email_processed_messages');
  if (!hasProcessed) return;

  const hasProviderConfigs = await knex.schema.hasTable('email_provider_configs');
  if (!hasProviderConfigs) {
    console.warn('[drop_email_processed_messages_provider_fk] email_provider_configs table missing; cannot re-add FK');
    return;
  }

  try {
    await knex.schema.raw(`
      ALTER TABLE email_processed_messages
      ADD CONSTRAINT email_processed_messages_provider_id_tenant_foreign
      FOREIGN KEY (provider_id, tenant)
      REFERENCES email_provider_configs (id, tenant)
      ON DELETE CASCADE
    `);
    console.log('✅ Re-added email_processed_messages_provider_id_tenant_foreign');
  } catch (e) {
    console.warn('[drop_email_processed_messages_provider_fk] Failed to re-add FK:', e);
  }
};

