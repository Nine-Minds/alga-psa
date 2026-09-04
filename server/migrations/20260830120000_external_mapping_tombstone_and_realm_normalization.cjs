/**
 * External mapping hardening: tombstone unlink + realm normalization.
 *
 * 1. Adds a nullable `deleted_at` column. Unlinking a mapping now tombstones
 *    the row (deleted_at set, sync_status 'unlinked') instead of deleting it,
 *    so a later export of a previously-linked document can be told it must
 *    explicitly relink-or-recreate rather than silently duplicating a remote
 *    accounting document.
 *
 * 2. Backfills the realm on legacy NULL-realm rows for QuickBooks Online.
 *    Before realm-aware consumption, mappings were written with a NULL realm;
 *    consumers now require an exact tenant + provider + entity type + realm
 *    match, with no NULL-realm fallback. A tenant that synced to its
 *    configured defaultRealm can be normalized deterministically from
 *    tenant_settings; rows for tenants without a stored default realm stay
 *    NULL and will fail closed on consumption until relinked against a
 *    connected realm.
 *
 *    The backfill is intentionally provider-scoped to `quickbooks_online`:
 *    `tenant_settings.accountingSync.defaultRealm` is a QuickBooks realm id
 *    (set by setDefaultQboRealm), so it is never a valid value for a Xero
 *    connection id. Xero rows are left NULL rather than stamped with a value
 *    that would be wrong; a Xero tenant whose NULL-realm rows predate realm
 *    tracking relinks them through the mapping screen before sync resumes.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function up(knex) {
  const hasDeletedAt = await knex.schema.hasColumn('tenant_external_entity_mappings', 'deleted_at');
  if (!hasDeletedAt) {
    await knex.schema.alterTable('tenant_external_entity_mappings', (table) => {
      table.timestamp('deleted_at', { useTz: true }).nullable();
    });
  }

  const hasSettings = await knex.schema.hasTable('tenant_settings');
  if (!hasSettings) {
    return;
  }

  // Per-tenant updates so the statement stays a single-shard UPDATE on Citus
  // (the mappings table is distributed by tenant). tenant_settings is read
  // coordinator-side; the small default-realm set makes the N updates cheap.
  const { rows } = await knex.raw(`
    SELECT tenant,
           settings->'accountingSync'->>'defaultRealm' AS default_realm
    FROM tenant_settings
    WHERE settings->'accountingSync'->>'defaultRealm' IS NOT NULL
      AND settings->'accountingSync'->>'defaultRealm' <> ''
  `);

  for (const row of rows) {
    await knex('tenant_external_entity_mappings')
      .where({
        tenant: row.tenant,
        integration_type: 'quickbooks_online',
        external_realm_id: null,
      })
      .update({
        external_realm_id: row.default_realm,
        updated_at: knex.fn.now(),
      });
  }
};

/**
 * @param { import("knex").Knex } knex
 */
exports.down = async function down(knex) {
  const hasDeletedAt = await knex.schema.hasColumn('tenant_external_entity_mappings', 'deleted_at');
  if (hasDeletedAt) {
    await knex.schema.alterTable('tenant_external_entity_mappings', (table) => {
      table.dropColumn('deleted_at');
    });
  }
};
