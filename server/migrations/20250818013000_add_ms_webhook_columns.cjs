// Add Microsoft vendor-config webhook fields to align with runtime code
/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_email_provider_config');
  if (!hasTable) return;

  const addColumnIfMissing = async (tableName, columnName, columnBuilder) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (!exists) {
      await knex.schema.alterTable(tableName, (table) => {
        columnBuilder(table, columnName);
      });
      console.log(`✅ Added column ${tableName}.${columnName}`);
    }
  };

  await addColumnIfMissing('microsoft_email_provider_config', 'webhook_subscription_id', (t, name) => t.text(name));
  await addColumnIfMissing('microsoft_email_provider_config', 'webhook_expires_at', (t, name) => t.timestamp(name, { useTz: true }));
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('microsoft_email_provider_config');
  if (!hasTable) return;

  const dropColumnIfPresent = async (tableName, columnName) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (exists) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn(columnName);
      });
      console.log(`✅ Dropped column ${tableName}.${columnName}`);
    }
  };

  await dropColumnIfPresent('microsoft_email_provider_config', 'webhook_subscription_id');
  await dropColumnIfPresent('microsoft_email_provider_config', 'webhook_expires_at');
};

