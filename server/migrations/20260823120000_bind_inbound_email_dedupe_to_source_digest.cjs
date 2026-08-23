/**
 * Bind legacy inbound-email guards to provider identity plus the exact MIME
 * digest.  The old RFC Message-ID key remains as a non-unique lookup for
 * legacy rows; it is not an idempotency boundary any more.
 */

exports.config = { transaction: true };

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('email_processed_messages')) {
    if (!(await knex.schema.hasColumn('email_processed_messages', 'provider_message_id'))) {
      await knex.schema.alterTable('email_processed_messages', (table) => table.text('provider_message_id').nullable());
    }
    if (!(await knex.schema.hasColumn('email_processed_messages', 'source_sha256'))) {
      await knex.schema.alterTable('email_processed_messages', (table) => table.text('source_sha256').nullable());
    }
    await knex.raw("UPDATE email_processed_messages SET provider_message_id = regexp_replace(message_id, '^provider:', '') WHERE provider_message_id IS NULL AND message_id LIKE 'provider:%'");
    // Legacy records have no trustworthy digest; retain their historical
    // first-wins behavior without making the forgeable key authoritative for
    // newly-digested records.
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS email_processed_messages_legacy_message_unique ON email_processed_messages (tenant, provider_id, message_id) WHERE provider_message_id IS NULL OR source_sha256 IS NULL');
    await knex.raw(`
      DELETE FROM email_processed_messages a USING email_processed_messages b
      WHERE a.tenant = b.tenant AND a.provider_id = b.provider_id
        AND a.provider_message_id = b.provider_message_id AND a.source_sha256 = b.source_sha256
        AND a.provider_message_id IS NOT NULL AND a.source_sha256 IS NOT NULL
        AND a.ctid < b.ctid
    `);
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS email_processed_messages_provider_source_unique ON email_processed_messages (tenant, provider_id, provider_message_id, source_sha256) WHERE provider_message_id IS NOT NULL AND source_sha256 IS NOT NULL');
  }

  if (await knex.schema.hasTable('inbound_email_effects')) {
    if (!(await knex.schema.hasColumn('inbound_email_effects', 'source_sha256'))) {
      await knex.schema.alterTable('inbound_email_effects', (table) => table.text('source_sha256').nullable());
    }
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_effects_legacy_identity_unique ON inbound_email_effects (tenant, provider_id, normalized_message_id, effect_type) WHERE source_sha256 IS NULL');
    await knex.raw(`
      DELETE FROM inbound_email_effects a USING inbound_email_effects b
      WHERE a.tenant = b.tenant AND a.provider_id = b.provider_id
        AND a.normalized_message_id = b.normalized_message_id AND a.source_sha256 = b.source_sha256
        AND a.effect_type = b.effect_type AND a.source_sha256 IS NOT NULL AND a.ctid < b.ctid
    `);
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_effects_provider_source_unique ON inbound_email_effects (tenant, provider_id, normalized_message_id, source_sha256, effect_type) WHERE source_sha256 IS NOT NULL');
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS email_processed_messages_provider_source_unique');
  await knex.raw('DROP INDEX IF EXISTS inbound_email_effects_provider_source_unique');
  await knex.raw('DROP INDEX IF EXISTS email_processed_messages_legacy_message_unique');
  await knex.raw('DROP INDEX IF EXISTS inbound_email_effects_legacy_identity_unique');
};
