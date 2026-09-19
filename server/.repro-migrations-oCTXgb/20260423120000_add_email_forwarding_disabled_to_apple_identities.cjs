/**
 * Track Apple private-relay email forwarding state.
 *
 * Apple sends `email-disabled` / `email-enabled` server-to-server notifications
 * when a user toggles forwarding for a private-relay address. We flip this
 * column so the rest of the system can skip sending transactional email to an
 * address that would silently bounce.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('apple_user_identities');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn(
    'apple_user_identities',
    'email_forwarding_disabled',
  );
  if (!hasColumn) {
    await knex.schema.alterTable('apple_user_identities', (table) => {
      table.boolean('email_forwarding_disabled').notNullable().defaultTo(false);
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('apple_user_identities');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn(
    'apple_user_identities',
    'email_forwarding_disabled',
  );
  if (hasColumn) {
    await knex.schema.alterTable('apple_user_identities', (table) => {
      table.dropColumn('email_forwarding_disabled');
    });
  }
};

// Disable transaction for Citus DB compatibility
exports.config = { transaction: false };
