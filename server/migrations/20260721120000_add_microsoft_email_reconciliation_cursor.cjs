/**
 * Keep the Microsoft Graph reconciliation cursor separate from last_sync_at.
 * Unified queue consumers advance last_sync_at after successful ingestion, so
 * it cannot also identify whether a polling window has been claimed.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
    table.timestamp('last_reconciliation_at', { useTz: true }).nullable();
  });

  // Both tables are tenant-distributed. Include the co-location key in the
  // UPDATE ... FROM join so this remains valid for Citus installations.
  await knex.raw(`
    UPDATE microsoft_email_provider_config mpc
    SET last_reconciliation_at = ep.last_sync_at
    FROM email_providers ep
    WHERE mpc.tenant = ep.tenant
      AND mpc.email_provider_id = ep.id
      AND ep.last_sync_at IS NOT NULL
  `);
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
    table.dropColumn('last_reconciliation_at');
  });
};
