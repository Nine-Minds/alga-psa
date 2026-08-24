/**
 * Bind legacy inbound-email guards to provider identity plus the exact MIME
 * digest.  The old RFC Message-ID key remains as a non-unique lookup for
 * legacy rows; it is not an idempotency boundary any more.
 */

exports.config = { transaction: true };

async function truncateDistributedLocalHeap(knex, tableName) {
  const citusInstalled = await knex.raw(
    "SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus"
  );
  if (!citusInstalled.rows[0].has_citus) return;

  const distributed = await knex.raw(
    `SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'public.${tableName}'::regclass`
  );
  if (distributed.rows.length > 0) {
    // Citus leaves coordinator-local heap rows behind after distribution.
    // They are invisible to normal queries but participate in index builds.
    await knex.raw(
      `SELECT truncate_local_data_after_distributing_table('public.${tableName}')`
    );
  }
}

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
    await truncateDistributedLocalHeap(knex, 'inbound_email_effects');

    // The original PK made the forgeable RFC Message-ID first-wins even when
    // the digest-aware partial index permitted a second MIME.  Preserve a
    // tenant-first primary key by moving it to the already-unique durable
    // effect identity, then remove its now-redundant unique constraint.
    await knex.raw('ALTER TABLE inbound_email_effects DROP CONSTRAINT IF EXISTS inbound_email_effects_pkey');
    await knex.raw('ALTER TABLE inbound_email_effects ADD CONSTRAINT inbound_email_effects_pkey PRIMARY KEY (tenant, inbox_id, effect_type)');
    await knex.raw('ALTER TABLE inbound_email_effects DROP CONSTRAINT IF EXISTS inbound_email_effects_inbox_effect_unique');

    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_effects_legacy_identity_unique ON inbound_email_effects (tenant, provider_id, normalized_message_id, effect_type) WHERE source_sha256 IS NULL');
    await knex.raw(`
      DELETE FROM inbound_email_effects a USING inbound_email_effects b
      WHERE a.tenant = b.tenant AND a.provider_id = b.provider_id
        AND a.normalized_message_id = b.normalized_message_id AND a.source_sha256 = b.source_sha256
        AND a.effect_type = b.effect_type AND a.source_sha256 IS NOT NULL AND a.ctid < b.ctid
    `);
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_effects_provider_source_unique ON inbound_email_effects (tenant, provider_id, normalized_message_id, source_sha256, effect_type) WHERE source_sha256 IS NOT NULL');
  }

  if (await knex.schema.hasTable('inbound_email_inbox')) {
    if (!(await knex.schema.hasColumn('inbound_email_inbox', 'source_sha256'))) {
      await knex.schema.alterTable('inbound_email_inbox', (table) => table.text('source_sha256').nullable());
    }
    await truncateDistributedLocalHeap(knex, 'inbound_email_inbox');

    // A pre-digest durable table may contain duplicate rows only if its old
    // unique guard was removed manually. Remove dependent audit rows first so
    // the inbox cleanup remains valid in databases with completed work.
    for (const dependentTable of ['inbound_email_effects', 'inbound_email_artifacts', 'inbound_email_outbox']) {
      if (await knex.schema.hasTable(dependentTable)) {
        await knex.raw(`
          DELETE FROM ${dependentTable} dependent
          USING inbound_email_inbox winner, inbound_email_inbox duplicate
          WHERE dependent.tenant = duplicate.tenant
            AND dependent.inbox_id = duplicate.inbox_id
            AND winner.tenant = duplicate.tenant
            AND winner.provider_id = duplicate.provider_id
            AND winner.normalized_message_id = duplicate.normalized_message_id
            AND winner.source_sha256 IS NOT DISTINCT FROM duplicate.source_sha256
            AND winner.inbox_id < duplicate.inbox_id
        `);
      }
    }
    await knex.raw(`
      DELETE FROM inbound_email_inbox duplicate
      USING inbound_email_inbox winner
      WHERE winner.tenant = duplicate.tenant
        AND winner.provider_id = duplicate.provider_id
        AND winner.normalized_message_id = duplicate.normalized_message_id
        AND winner.source_sha256 IS NOT DISTINCT FROM duplicate.source_sha256
        AND winner.inbox_id < duplicate.inbox_id
    `);

    // Add the digest-aware and legacy guards before dropping the old RFC-only
    // constraint. Tenant is first for Citus distributed-table uniqueness.
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_inbox_provider_source_unique ON inbound_email_inbox (tenant, provider_id, normalized_message_id, source_sha256) WHERE source_sha256 IS NOT NULL');
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS inbound_email_inbox_legacy_identity_unique ON inbound_email_inbox (tenant, provider_id, normalized_message_id) WHERE source_sha256 IS NULL');
    await knex.raw('ALTER TABLE inbound_email_inbox DROP CONSTRAINT IF EXISTS inbound_email_inbox_identity_unique');
    await knex.raw('DROP INDEX IF EXISTS inbound_email_inbox_identity_unique');
  }
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS email_processed_messages_provider_source_unique');
  await knex.raw('DROP INDEX IF EXISTS inbound_email_effects_provider_source_unique');
  await knex.raw('DROP INDEX IF EXISTS email_processed_messages_legacy_message_unique');
  await knex.raw('DROP INDEX IF EXISTS inbound_email_effects_legacy_identity_unique');
  await knex.raw('DROP INDEX IF EXISTS inbound_email_inbox_provider_source_unique');
  await knex.raw('DROP INDEX IF EXISTS inbound_email_inbox_legacy_identity_unique');
};
