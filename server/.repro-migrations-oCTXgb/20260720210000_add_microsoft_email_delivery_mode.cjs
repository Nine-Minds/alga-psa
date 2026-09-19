/**
 * Track whether Microsoft inbound email uses Graph change notifications or
 * outbound-only reconciliation polling.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
    table.text('delivery_mode').notNullable().defaultTo('polling');
    table.timestamp('last_webhook_delivery_at', { useTz: true }).nullable();
    table.integer('webhook_silent_runs').notNullable().defaultTo(0);
    table.timestamp('next_subscription_probe_at', { useTz: true }).nullable();
  });

  const tenants = await knex('microsoft_email_provider_config').distinct('tenant');
  for (const { tenant } of tenants) {
    await knex('microsoft_email_provider_config')
      .where({ tenant })
      .whereNotNull('webhook_subscription_id')
      .update({ delivery_mode: 'webhook' });
  }

  await knex.raw(`
    ALTER TABLE microsoft_email_provider_config
    ADD CONSTRAINT microsoft_email_provider_config_delivery_mode_check
    CHECK (delivery_mode IN ('webhook', 'polling'))
  `);
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE microsoft_email_provider_config
    DROP CONSTRAINT IF EXISTS microsoft_email_provider_config_delivery_mode_check
  `);
  await knex.schema.alterTable('microsoft_email_provider_config', (table) => {
    table.dropColumn('next_subscription_probe_at');
    table.dropColumn('webhook_silent_runs');
    table.dropColumn('last_webhook_delivery_at');
    table.dropColumn('delivery_mode');
  });
};
