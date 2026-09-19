/**
 * Migration to add enable_credit_expiration flag to company_billing_settings and default_billing_settings tables
 * 
 * This migration adds a boolean column to control whether credit expiration is enabled at all,
 * separate from the expiration days setting.
 * 
 * Run: npx knex migrate:up 20250226125645_add_credit_expiration_toggle.cjs --knexfile knexfile.cjs --env migration
 * Rollback: npx knex migrate:down 20250226125645_add_credit_expiration_toggle.cjs --knexfile knexfile.cjs --env migration
 */
exports.up = async function(knex) {
  // Add enable_credit_expiration flag to default_billing_settings table
  await knex.schema.alterTable('default_billing_settings', (table) => {
    table.boolean('enable_credit_expiration').defaultTo(true);
  });

  // Add enable_credit_expiration flag to company_billing_settings table
  await knex.schema.alterTable('company_billing_settings', (table) => {
    table.boolean('enable_credit_expiration');
  });

  // Add comments to the new columns
  await knex.schema.raw(`
    COMMENT ON COLUMN default_billing_settings.enable_credit_expiration IS 'Global setting to enable or disable credit expiration functionality';
    COMMENT ON COLUMN company_billing_settings.enable_credit_expiration IS 'Company-specific setting to enable or disable credit expiration (overrides default)';
  `);

  return knex;
};

exports.down = async function(knex) {
  // Remove enable_credit_expiration flag from company_billing_settings table
  await knex.schema.alterTable('company_billing_settings', (table) => {
    table.dropColumn('enable_credit_expiration');
  });

  // Remove enable_credit_expiration flag from default_billing_settings table
  await knex.schema.alterTable('default_billing_settings', (table) => {
    table.dropColumn('enable_credit_expiration');
  });

  return knex;
};