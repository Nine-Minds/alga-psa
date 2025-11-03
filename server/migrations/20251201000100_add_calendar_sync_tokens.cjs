/**
 * Add sync token and delta link storage to calendar provider configs.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasGoogleSyncToken = await knex.schema.hasColumn('google_calendar_provider_config', 'sync_token');
  if (!hasGoogleSyncToken) {
    await knex.schema.alterTable('google_calendar_provider_config', (table) => {
      table.text('sync_token').nullable();
    });
  }

  const hasMicrosoftDeltaLink = await knex.schema.hasColumn('microsoft_calendar_provider_config', 'delta_link');
  if (!hasMicrosoftDeltaLink) {
    await knex.schema.alterTable('microsoft_calendar_provider_config', (table) => {
      table.text('delta_link').nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasGoogleSyncToken = await knex.schema.hasColumn('google_calendar_provider_config', 'sync_token');
  if (hasGoogleSyncToken) {
    await knex.schema.alterTable('google_calendar_provider_config', (table) => {
      table.dropColumn('sync_token');
    });
  }

  const hasMicrosoftDeltaLink = await knex.schema.hasColumn('microsoft_calendar_provider_config', 'delta_link');
  if (hasMicrosoftDeltaLink) {
    await knex.schema.alterTable('microsoft_calendar_provider_config', (table) => {
      table.dropColumn('delta_link');
    });
  }
};

// Citus deployments cannot alter distributed tables inside a transaction.
exports.config = { transaction: false };
