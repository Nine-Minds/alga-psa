/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('api_keys', (table) => {
    table
      .string('purpose')
      .notNullable()
      .defaultTo('general');
    table.jsonb('metadata').nullable();
    table.integer('usage_limit').nullable();
    table
      .integer('usage_count')
      .notNullable()
      .defaultTo(0);
  });

  await knex.schema.alterTable('api_keys', (table) => {
    table.index(['purpose', 'expires_at'], 'api_keys_purpose_expires_at_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('api_keys', (table) => {
    table.dropIndex(['purpose', 'expires_at'], 'api_keys_purpose_expires_at_idx');
  });

  await knex.schema.alterTable('api_keys', (table) => {
    table.dropColumn('usage_count');
    table.dropColumn('usage_limit');
    table.dropColumn('metadata');
    table.dropColumn('purpose');
  });
};
