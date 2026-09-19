/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasLastLoginAt = await knex.schema.hasColumn('users', 'last_login_at');
  const hasLastLoginMethod = await knex.schema.hasColumn('users', 'last_login_method');

  if (hasLastLoginAt && hasLastLoginMethod) {
    return;
  }

  await knex.schema.alterTable('users', table => {
    if (!hasLastLoginAt) {
      table.timestamp('last_login_at', { useTz: true }).nullable();
    }
    if (!hasLastLoginMethod) {
      table.string('last_login_method', 50).nullable(); // 'credentials', 'google', 'keycloak', etc.
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasLastLoginAt = await knex.schema.hasColumn('users', 'last_login_at');
  const hasLastLoginMethod = await knex.schema.hasColumn('users', 'last_login_method');

  if (!hasLastLoginAt && !hasLastLoginMethod) {
    return;
  }

  await knex.schema.alterTable('users', table => {
    if (hasLastLoginAt) {
      table.dropColumn('last_login_at');
    }
    if (hasLastLoginMethod) {
      table.dropColumn('last_login_method');
    }
  });
};
