const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch (error) {
    console.warn(`Unable to check column ${columnName} on ${tableName}:`, error);
    return false;
  }
};

exports.up = async function up(knex) {
  const tableName = 'default_billing_settings';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping default currency migration: default_billing_settings table not found');
    return;
  }

  const hasDefaultCurrencyCode = await hasColumn(knex, tableName, 'default_currency_code');
  if (hasDefaultCurrencyCode) {
    console.log('⊘ default_currency_code column already exists, skipping');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    table.string('default_currency_code', 3).notNullable().defaultTo('USD');
  });

  console.log('✓ Added default_currency_code column to default_billing_settings');
};

exports.down = async function down(knex) {
  const tableName = 'default_billing_settings';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ default_billing_settings table not found, nothing to roll back');
    return;
  }

  const hasDefaultCurrencyCode = await hasColumn(knex, tableName, 'default_currency_code');
  if (!hasDefaultCurrencyCode) {
    console.log('⊘ default_currency_code column already absent, nothing to roll back');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    table.dropColumn('default_currency_code');
  });

  console.log('✓ Removed default_currency_code column from default_billing_settings');
};

exports.config = { transaction: false };
