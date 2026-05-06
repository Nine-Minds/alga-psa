/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('webhooks', (table) => {
    table.uuid('tenant').notNullable().references('tenant').inTable('tenants').onDelete('CASCADE');
    table.uuid('webhook_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('name').notNullable();
    table.text('url').notNullable();
    table.text('method').notNullable().defaultTo('POST');
    table.specificType('event_types', 'text[]').notNullable().defaultTo(knex.raw("'{}'::text[]"));
    table.jsonb('custom_headers');
    table.text('signing_secret_vault_path').notNullable();
    table.text('security_type').notNullable().defaultTo('hmac_signature');
    table.boolean('verify_ssl').notNullable().defaultTo(true);
    table.jsonb('retry_config');
    table.integer('rate_limit_per_min').notNullable().defaultTo(100);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.integer('total_deliveries').notNullable().defaultTo(0);
    table.integer('successful_deliveries').notNullable().defaultTo(0);
    table.integer('failed_deliveries').notNullable().defaultTo(0);
    table.timestamp('last_delivery_at', { useTz: true });
    table.timestamp('last_success_at', { useTz: true });
    table.timestamp('last_failure_at', { useTz: true });
    table.timestamp('auto_disabled_at', { useTz: true });
    table.uuid('created_by_user_id').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'webhook_id']);
    table.index(['tenant'], 'webhooks_tenant_idx');
    table.index(['tenant', 'is_active'], 'webhooks_tenant_active_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('webhooks');
};
