/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('mobile_auth_otts', (table) => {
    table.uuid('mobile_auth_ott_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('user_id').notNullable();
    table.uuid('session_id').nullable();
    table.text('ott_hash').notNullable().unique();
    table.text('state').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at').nullable();
    table.text('device_id').nullable();
    table.jsonb('metadata').nullable();

    table.index(['tenant', 'user_id']);
    table.index(['expires_at']);
    table.index(['used_at']);
  });

  await knex.schema.createTable('mobile_refresh_tokens', (table) => {
    table.uuid('mobile_refresh_token_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('user_id').notNullable();
    table.uuid('api_key_id').nullable();
    table.text('token_hash').notNullable().unique();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();
    table.timestamp('revoked_at').nullable();
    table.uuid('replaced_by_id').nullable();
    table.timestamp('last_used_at').nullable();
    table.text('device_id').nullable();
    table.jsonb('device').nullable();

    table.foreign('replaced_by_id').references('mobile_refresh_token_id').inTable('mobile_refresh_tokens');
    table.index(['tenant', 'user_id']);
    table.index(['expires_at']);
    table.index(['revoked_at']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mobile_refresh_tokens');
  await knex.schema.dropTableIfExists('mobile_auth_otts');
};

