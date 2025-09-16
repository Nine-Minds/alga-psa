/**
 * Migration: Add language_code column to email template tables
 * This migration adds language support to email templates for i18n
 * Citus-compatible: unique constraints include tenant column for distributed tables
 */

exports.up = async function (knex) {
  // Add language_code to system_email_templates (reference table in Citus)
  await knex.schema.alterTable('system_email_templates', (table) => {
    table.string('language_code', 10).defaultTo('en').notNullable();
  });

  // Create index after column is added
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_system_email_templates_name_language ON system_email_templates(name, language_code)');

  // Add language_code to tenant_email_templates (distributed table in Citus)
  await knex.schema.alterTable('tenant_email_templates', (table) => {
    table.string('language_code', 10).defaultTo('en').notNullable();
  });

  // Create index including tenant column for Citus compatibility
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_tenant_email_templates_tenant_name_language ON tenant_email_templates(tenant, name, language_code)');

  // Drop existing unique constraints if they exist
  await knex.raw('ALTER TABLE system_email_templates DROP CONSTRAINT IF EXISTS system_email_templates_name_key');
  await knex.raw('ALTER TABLE tenant_email_templates DROP CONSTRAINT IF EXISTS tenant_email_templates_tenant_name_key');

  // Add new unique constraints including language_code
  await knex.raw('ALTER TABLE system_email_templates ADD CONSTRAINT system_email_templates_name_language_key UNIQUE (name, language_code)');

  // For Citus distributed tables, unique constraints must include the distribution column (tenant)
  await knex.raw('ALTER TABLE tenant_email_templates ADD CONSTRAINT tenant_email_templates_tenant_name_language_key UNIQUE (tenant, name, language_code)');

  // Note: user_preferences uses a key-value pattern (setting_name, setting_value)
  // Locale will be stored as: setting_name = 'locale', setting_value = '"en"' or '"fr"'
  // No schema change needed, but add index for better performance
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_locale_setting
    ON user_preferences(tenant, setting_name)
    WHERE setting_name = 'locale'
  `);

  // Note: tenant_settings uses a generic 'settings' JSONB column
  // Locale settings will be stored in settings.clientPortal.defaultLocale and settings.clientPortal.enabledLocales
  // Add comment to document the expected structure
  await knex.raw(`
    COMMENT ON COLUMN tenant_settings.settings IS
    'General tenant settings as JSONB. Expected structure includes:
    {
      "clientPortal": {
        "defaultLocale": "en",
        "enabledLocales": ["en", "fr"],
        "branding": {...},
        "theme": {...}
      },
      ...other settings...
    }'
  `);
};

exports.down = async function (knex) {
  // Remove unique constraints with language_code
  await knex.raw('ALTER TABLE system_email_templates DROP CONSTRAINT IF EXISTS system_email_templates_name_language_key');
  await knex.raw('ALTER TABLE tenant_email_templates DROP CONSTRAINT IF EXISTS tenant_email_templates_tenant_name_language_key');

  // Restore original unique constraints (if they existed)
  // Note: These may fail if constraints already exist, which is fine
  try {
    await knex.raw('ALTER TABLE system_email_templates ADD CONSTRAINT system_email_templates_name_key UNIQUE (name)');
  } catch (e) {
    // Constraint might already exist
  }

  try {
    // For Citus, unique constraint must include distribution column
    await knex.raw('ALTER TABLE tenant_email_templates ADD CONSTRAINT tenant_email_templates_tenant_name_key UNIQUE (tenant, name)');
  } catch (e) {
    // Constraint might already exist
  }

  // Remove indexes
  await knex.raw('DROP INDEX IF EXISTS idx_system_email_templates_name_language');
  await knex.raw('DROP INDEX IF EXISTS idx_tenant_email_templates_tenant_name_language');
  await knex.raw('DROP INDEX IF EXISTS idx_user_preferences_locale_setting');

  // Remove language_code columns
  await knex.schema.alterTable('system_email_templates', (table) => {
    table.dropColumn('language_code');
  });

  await knex.schema.alterTable('tenant_email_templates', (table) => {
    table.dropColumn('language_code');
  });

  // Note: No need to remove locale from user_preferences as we're using the existing key-value structure
};