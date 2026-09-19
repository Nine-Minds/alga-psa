/**
 * Add user_id to calendar_providers to make calendar sync user-specific
 *
 * Previously, calendar providers were tenant-level, meaning all schedule entries
 * synced to a single calendar regardless of assignment. This change makes each
 * calendar provider belong to a specific user, so only their entries sync.
 */

exports.up = async function(knex) {
  // Add user_id column to calendar_providers
  await knex.schema.alterTable('calendar_providers', function(table) {
    table.uuid('user_id').nullable(); // Nullable initially for existing rows
  });

  // Add foreign key constraint
  await knex.schema.raw(`
    ALTER TABLE calendar_providers
    ADD CONSTRAINT calendar_providers_user_id_foreign
    FOREIGN KEY (user_id, tenant)
    REFERENCES users(user_id, tenant)
    ON DELETE CASCADE
  `);

  // Add index for querying by user
  await knex.schema.raw(`
    CREATE INDEX idx_calendar_providers_user_id
    ON calendar_providers (user_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX idx_calendar_providers_tenant_user_id
    ON calendar_providers (tenant, user_id)
  `);

  // Add unique constraint: one provider per type per user
  // First drop the old unique constraint
  await knex.schema.raw(`
    ALTER TABLE calendar_providers
    DROP CONSTRAINT IF EXISTS calendar_providers_tenant_calendar_id_provider_type_unique
  `);

  // Add new unique constraint including user_id
  await knex.schema.raw(`
    ALTER TABLE calendar_providers
    ADD CONSTRAINT calendar_providers_tenant_user_provider_unique
    UNIQUE (tenant, user_id, provider_type)
  `);
};

exports.down = async function(knex) {
  // Remove the new unique constraint
  await knex.schema.raw(`
    ALTER TABLE calendar_providers
    DROP CONSTRAINT IF EXISTS calendar_providers_tenant_user_provider_unique
  `);

  // Restore the old unique constraint
  await knex.schema.raw(`
    ALTER TABLE calendar_providers
    ADD CONSTRAINT calendar_providers_tenant_calendar_id_provider_type_unique
    UNIQUE (tenant, calendar_id, provider_type)
  `);

  // Remove indexes
  await knex.schema.raw(`
    DROP INDEX IF EXISTS idx_calendar_providers_tenant_user_id
  `);

  await knex.schema.raw(`
    DROP INDEX IF EXISTS idx_calendar_providers_user_id
  `);

  // Remove foreign key constraint
  await knex.schema.raw(`
    ALTER TABLE calendar_providers
    DROP CONSTRAINT IF EXISTS calendar_providers_user_id_foreign
  `);

  // Remove user_id column
  await knex.schema.alterTable('calendar_providers', function(table) {
    table.dropColumn('user_id');
  });
};
