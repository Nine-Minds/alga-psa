/**
 * Migration: Add language_code column to email template tables
 * This migration adds language support to email templates for i18n
 * Citus-compatible: unique constraints include tenant column for distributed tables
 */

const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

const DEFAULT_LANGUAGE_CODE = 'en';
const LANGUAGE_COLUMN = 'language_code';
const TEMP_LANGUAGE_COLUMN = 'language_code_tmp';
const NULL_VALUES_ERROR = 'contains null values';

const assertSupportedTable = (tableName) => {
  if (!['system_email_templates', 'tenant_email_templates'].includes(tableName)) {
    throw new Error(`Unexpected table for language migration: ${tableName}`);
  }
  return tableName;
};

const addLanguageColumnIfMissing = async (knex, tableName) => {
  await knex.raw(
    `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${LANGUAGE_COLUMN} VARCHAR(10)`
  );
};

const populateLanguageDefaults = async (knex, tableName) => {
  await knex.raw(`LOCK TABLE ${tableName} IN SHARE ROW EXCLUSIVE MODE`);

  await knex.raw(
    `ALTER TABLE ${tableName} ALTER COLUMN ${LANGUAGE_COLUMN} SET DEFAULT '${DEFAULT_LANGUAGE_CODE}'`
  );

  await knex.raw(
    `UPDATE ${tableName} SET ${LANGUAGE_COLUMN} = COALESCE(${LANGUAGE_COLUMN}, '${DEFAULT_LANGUAGE_CODE}') WHERE ${LANGUAGE_COLUMN} IS NULL`
  );
};

const rebuildLanguageColumn = async (knex, tableName) => {
  await knex.raw(
    `ALTER TABLE ${tableName} DROP COLUMN IF EXISTS ${TEMP_LANGUAGE_COLUMN}`
  );

  await knex.raw(
    `ALTER TABLE ${tableName} ADD COLUMN ${TEMP_LANGUAGE_COLUMN} VARCHAR(10) DEFAULT '${DEFAULT_LANGUAGE_CODE}' NOT NULL`
  );

  await knex.raw(
    `UPDATE ${tableName} SET ${TEMP_LANGUAGE_COLUMN} = COALESCE(${LANGUAGE_COLUMN}, '${DEFAULT_LANGUAGE_CODE}')`
  );

  await knex.raw(
    `ALTER TABLE ${tableName} DROP COLUMN IF EXISTS ${LANGUAGE_COLUMN}`
  );

  await knex.raw(
    `ALTER TABLE ${tableName} RENAME COLUMN ${TEMP_LANGUAGE_COLUMN} TO ${LANGUAGE_COLUMN}`
  );

  await knex.raw(
    `ALTER TABLE ${tableName} ALTER COLUMN ${LANGUAGE_COLUMN} SET DEFAULT '${DEFAULT_LANGUAGE_CODE}'`
  );

  await knex.raw(
    `ALTER TABLE ${tableName} ALTER COLUMN ${LANGUAGE_COLUMN} SET NOT NULL`
  );
};

const ensureLanguageCodeColumn = async (knex, tableName) => {
  const table = assertSupportedTable(tableName);

  await addLanguageColumnIfMissing(knex, table);

  await knex.transaction(async (trx) => {
    await populateLanguageDefaults(trx, table);

    try {
      await trx.raw(
        `ALTER TABLE ${table} ALTER COLUMN ${LANGUAGE_COLUMN} SET NOT NULL`
      );
    } catch (error) {
      if (!error.message?.includes(NULL_VALUES_ERROR)) {
        throw error;
      }

      await rebuildLanguageColumn(trx, table);
    }
  });
};

exports.up = async function (knex) {
  await ensureSequentialMode(knex);

  // Clean up any partially applied constraints/indexes from previous runs
  await knex.raw('ALTER TABLE system_email_templates DROP CONSTRAINT IF EXISTS system_email_templates_name_language_key');
  await knex.raw('ALTER TABLE tenant_email_templates DROP CONSTRAINT IF EXISTS tenant_email_templates_tenant_name_language_key');
  await knex.raw('DROP INDEX IF EXISTS idx_system_email_templates_name_language');
  await knex.raw('DROP INDEX IF EXISTS idx_tenant_email_templates_tenant_name_language');

  // Add language_code to system_email_templates (reference table in Citus)
  await ensureLanguageCodeColumn(knex, 'system_email_templates');

  // Create index after column is added
  await knex.raw('CREATE INDEX IF NOT EXISTS idx_system_email_templates_name_language ON system_email_templates(name, language_code)');

  // Add language_code to tenant_email_templates (distributed table in Citus)
  await ensureLanguageCodeColumn(knex, 'tenant_email_templates');

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
      "defaultLocale": "en",  -- Tenant-wide default locale
      ...other settings...
    }'
  `);

  // Add comment for companies.properties to document language preference
  await knex.raw(`
    COMMENT ON COLUMN companies.properties IS
    'Company properties as JSONB. Expected structure includes:
    {
      "defaultLocale": "en",  -- Company-wide default locale for all contacts
      ...other properties...
    }'
  `);
};

exports.down = async function (knex) {
  await ensureSequentialMode(knex);

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
};

exports.config = { transaction: false };
