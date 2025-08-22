/**
 * Add ticket_display_settings JSONB column to tenant_settings.
 */

/** @param { import('knex').Knex } knex */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('tenant_settings');
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn('tenant_settings', 'ticket_display_settings');
  if (hasColumn) return;

  await knex.schema.alterTable('tenant_settings', (table) => {
    table.jsonb('ticket_display_settings').nullable();
  });
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('tenant_settings');
  if (!hasTable) return;
  const hasColumn = await knex.schema.hasColumn('tenant_settings', 'ticket_display_settings');
  if (!hasColumn) return;

  await knex.schema.alterTable('tenant_settings', (table) => {
    table.dropColumn('ticket_display_settings');
  });
};

