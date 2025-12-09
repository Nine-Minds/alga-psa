/**
 * Add webhook health tracking columns to email_provider_health
 */

exports.up = async function (knex) {
  await knex.schema.table('email_provider_health', function (table) {
    table.string('subscription_status'); // enum: healthy, renewing, error
    table.timestamp('subscription_expires_at');
    table.timestamp('last_renewal_attempt_at');
    table.string('last_renewal_result');
    table.text('failure_reason');
    table.timestamp('last_notification_received_at');
  });

  // Add index for monitoring, using the standardized 'tenant' column
  await knex.schema.raw(`
    CREATE INDEX idx_email_provider_health_subscription_status 
    ON email_provider_health (tenant, subscription_status)
  `);
};

exports.down = async function (knex) {
  await knex.schema.table('email_provider_health', function (table) {
    table.dropColumn('subscription_status');
    table.dropColumn('subscription_expires_at');
    table.dropColumn('last_renewal_attempt_at');
    table.dropColumn('last_renewal_result');
    table.dropColumn('failure_reason');
    table.dropColumn('last_notification_received_at');
  });
};

