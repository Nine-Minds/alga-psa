/**
 * Migration to add credit expiration settings to company_billing_settings and default_billing_settings tables
 * Run: npx knex migrate:up 20250226125644_add_credit_expiration_settings.cjs --knexfile knexfile.cjs --env migration
 * Rollback: npx knex migrate:down 20250226125644_add_credit_expiration_settings.cjs --knexfile knexfile.cjs --env migration
 */

exports.up = async function(knex) {
  // Add credit expiration settings to default_billing_settings table
  await knex.schema.alterTable('default_billing_settings', (table) => {
    table.integer('credit_expiration_days').defaultTo(365);
    table.specificType('credit_expiration_notification_days', 'INTEGER[]').defaultTo('{30, 7, 1}');
  });

  // Add credit expiration settings to company_billing_settings table
  await knex.schema.alterTable('company_billing_settings', (table) => {
    table.integer('credit_expiration_days');
    table.specificType('credit_expiration_notification_days', 'INTEGER[]');
  });

  // Add comments to the columns for documentation
  await knex.schema.raw(`
    COMMENT ON COLUMN default_billing_settings.credit_expiration_days IS 'Default number of days before credits expire';
    COMMENT ON COLUMN default_billing_settings.credit_expiration_notification_days IS 'Default days before expiration to send notifications';
    COMMENT ON COLUMN company_billing_settings.credit_expiration_days IS 'Company-specific number of days before credits expire (overrides default)';
    COMMENT ON COLUMN company_billing_settings.credit_expiration_notification_days IS 'Company-specific days before expiration to send notifications (overrides default)';
  `);
};

exports.down = async function(knex) {
  // Remove credit expiration settings from company_billing_settings table
  await knex.schema.alterTable('company_billing_settings', (table) => {
    table.dropColumn('credit_expiration_days');
    table.dropColumn('credit_expiration_notification_days');
  });

  // Remove credit expiration settings from default_billing_settings table
  await knex.schema.alterTable('default_billing_settings', (table) => {
    table.dropColumn('credit_expiration_days');
    table.dropColumn('credit_expiration_notification_days');
  });
};
