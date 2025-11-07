/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasPurpose = await knex.schema.hasColumn('api_keys', 'purpose');
  const hasMetadata = await knex.schema.hasColumn('api_keys', 'metadata');
  const hasUsageLimit = await knex.schema.hasColumn('api_keys', 'usage_limit');
  const hasUsageCount = await knex.schema.hasColumn('api_keys', 'usage_count');

  if (!hasPurpose || !hasMetadata || !hasUsageLimit || !hasUsageCount) {
    await knex.schema.alterTable('api_keys', (table) => {
      if (!hasPurpose) {
        table.string('purpose').notNullable().defaultTo('general');
      }
      if (!hasMetadata) {
        table.jsonb('metadata').nullable();
      }
      if (!hasUsageLimit) {
        table.integer('usage_limit').nullable();
      }
      if (!hasUsageCount) {
        table.integer('usage_count').notNullable().defaultTo(0);
      }
    });
  }

  const indexExists = await knex
    .raw(
      `
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = ?
        LIMIT 1
      `,
      ['api_keys_purpose_expires_at_idx']
    )
    .then((result) => result.rowCount > 0);

  if (!indexExists) {
    await knex.schema.alterTable('api_keys', (table) => {
      table.index(['purpose', 'expires_at'], 'api_keys_purpose_expires_at_idx');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const indexExists = await knex
    .raw(
      `
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND indexname = ?
        LIMIT 1
      `,
      ['api_keys_purpose_expires_at_idx']
    )
    .then((result) => result.rowCount > 0);

  if (indexExists) {
    await knex.schema.alterTable('api_keys', (table) => {
      table.dropIndex(['purpose', 'expires_at'], 'api_keys_purpose_expires_at_idx');
    });
  }

  const hasUsageCount = await knex.schema.hasColumn('api_keys', 'usage_count');
  const hasUsageLimit = await knex.schema.hasColumn('api_keys', 'usage_limit');
  const hasMetadata = await knex.schema.hasColumn('api_keys', 'metadata');
  const hasPurpose = await knex.schema.hasColumn('api_keys', 'purpose');

  if (hasUsageCount || hasUsageLimit || hasMetadata || hasPurpose) {
    await knex.schema.alterTable('api_keys', (table) => {
      if (hasUsageCount) {
        table.dropColumn('usage_count');
      }
      if (hasUsageLimit) {
        table.dropColumn('usage_limit');
      }
      if (hasMetadata) {
        table.dropColumn('metadata');
      }
      if (hasPurpose) {
        table.dropColumn('purpose');
      }
    });
  }
};
