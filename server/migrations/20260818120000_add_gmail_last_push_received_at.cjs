/**
 * Record when a Gmail Pub/Sub push was last accepted for a provider.
 *
 * Gmail delivery can break in ways that leave every stored field looking
 * healthy — an expired watch, a subscription pointing at a stale audience.
 * A timestamp written by the webhook route on each verified push is the only
 * direct evidence that mail is actually arriving, and it is what the Gmail
 * diagnostics check reports.
 */

exports.up = async function up(knex) {
  const exists = await knex.schema.hasColumn('google_email_provider_config', 'last_push_received_at');
  if (!exists) {
    await knex.schema.table('google_email_provider_config', (table) => {
      table.timestamp('last_push_received_at').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasColumn('google_email_provider_config', 'last_push_received_at');
  if (exists) {
    await knex.schema.table('google_email_provider_config', (table) => {
      table.dropColumn('last_push_received_at');
    });
  }
};
