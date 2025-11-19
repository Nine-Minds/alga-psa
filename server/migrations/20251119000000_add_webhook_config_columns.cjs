/**
 * Add webhook configuration columns to vendor-specific email provider config tables
 * These columns were previously assumed to exist or were part of an older schema.
 */

exports.up = async function(knex) {
  // Add columns to microsoft_email_provider_config
  await knex.schema.table('microsoft_email_provider_config', function(table) {
    table.text('webhook_subscription_id').nullable();
    table.text('webhook_verification_token').nullable();
    table.timestamp('webhook_expires_at').nullable();
    table.timestamp('last_subscription_renewal').nullable();
  });

  // Add columns to google_email_provider_config
  await knex.schema.table('google_email_provider_config', function(table) {
    // Google does not use subscriptionId/verificationToken/expiresAt for watches, but we can store them if needed for other scenarios
    table.text('webhook_subscription_id').nullable(); // Not directly used by Gmail watch
    table.text('webhook_verification_token').nullable(); // Not directly used by Gmail watch
    table.timestamp('webhook_expires_at').nullable(); // Not directly used by Gmail watch
    table.timestamp('last_subscription_renewal').nullable(); // Not directly used by Gmail watch
  });

  console.log('✅ Added webhook configuration columns to vendor email config tables');
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
