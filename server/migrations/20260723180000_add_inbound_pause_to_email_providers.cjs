/**
 * Add an explicit inbound-ingestion pause that is independent of is_active.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('email_providers', (table) => {
    table.timestamp('inbound_paused_at', { useTz: true }).nullable();
    table.text('inbound_pause_reason').nullable();
  });

  await knex.raw(`
    ALTER TABLE email_providers
    ADD CONSTRAINT email_providers_inbound_pause_reason_check
    CHECK (
      (inbound_paused_at IS NULL AND inbound_pause_reason IS NULL)
      OR
      (inbound_paused_at IS NOT NULL AND inbound_pause_reason IN ('manual', 'tenant_cancelled'))
    )
  `);
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE email_providers
    DROP CONSTRAINT IF EXISTS email_providers_inbound_pause_reason_check
  `);

  await knex.schema.alterTable('email_providers', (table) => {
    table.dropColumn('inbound_pause_reason');
    table.dropColumn('inbound_paused_at');
  });
};
