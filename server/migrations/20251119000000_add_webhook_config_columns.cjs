/**
 * Add webhook configuration columns to vendor-specific email provider config tables
 * These columns were previously assumed to exist or were part of an older schema.
 */

exports.up = async function(knex) {
  const addColumnIfNotExists = async (tableName, columnName, type) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (!exists) {
      await knex.schema.table(tableName, (table) => {
        if (type === 'timestamp') {
           table.timestamp(columnName).nullable();
        } else {
           table.text(columnName).nullable();
        }
      });
    }
  };

  // Add columns to microsoft_email_provider_config
  await addColumnIfNotExists('microsoft_email_provider_config', 'webhook_subscription_id', 'text');
  await addColumnIfNotExists('microsoft_email_provider_config', 'webhook_verification_token', 'text');
  await addColumnIfNotExists('microsoft_email_provider_config', 'webhook_expires_at', 'timestamp');
  await addColumnIfNotExists('microsoft_email_provider_config', 'last_subscription_renewal', 'timestamp');

  // Add columns to google_email_provider_config
  await addColumnIfNotExists('google_email_provider_config', 'webhook_subscription_id', 'text');
  await addColumnIfNotExists('google_email_provider_config', 'webhook_verification_token', 'text');
  await addColumnIfNotExists('google_email_provider_config', 'webhook_expires_at', 'timestamp');
  await addColumnIfNotExists('google_email_provider_config', 'last_subscription_renewal', 'timestamp');

  console.log('✅ Added webhook configuration columns to vendor email config tables (idempotent)');
};

exports.down = async function(knex) {
  // Drop columns from microsoft_email_provider_config
  await knex.schema.table('microsoft_email_provider_config', function(table) {
    table.dropColumn('webhook_subscription_id');
    table.dropColumn('webhook_verification_token');
    table.dropColumn('webhook_expires_at');
    table.dropColumn('last_subscription_renewal');
  });

  // Drop columns from google_email_provider_config
  await knex.schema.table('google_email_provider_config', function(table) {
    table.dropColumn('webhook_subscription_id');
    table.dropColumn('webhook_verification_token');
    table.dropColumn('webhook_expires_at');
    table.dropColumn('last_subscription_renewal');
  });

  console.log('✅ Dropped webhook configuration columns from vendor email config tables');
};