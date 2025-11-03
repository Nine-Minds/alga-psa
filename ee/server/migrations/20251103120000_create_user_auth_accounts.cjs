/**
 * Migration: Create user_auth_accounts table
 *
 * Stores links between internal users and external OAuth providers (Google, Microsoft).
 * The migration is idempotent and safe to rerun.
 */

const TABLE_NAME = 'user_auth_accounts';

const ensureTable = async (knex, tableName, createFn) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    await createFn();
  }
};

const createUserAuthAccountsTable = (knex) =>
  knex.schema.createTable(TABLE_NAME, (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('user_id').notNullable();
    table.text('provider').notNullable();
    table.text('provider_account_id').notNullable();
    table.text('provider_email');
    table.jsonb('metadata').defaultTo(knex.raw("'{}'::jsonb"));
    table.timestamp('linked_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('last_used_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'user_id', 'provider']);

    table
      .foreign('tenant')
      .references('tenants.tenant')
      .onDelete('CASCADE');

    table
      .foreign('user_id')
      .references('user_id')
      .inTable('users')
      .onDelete('CASCADE');

    table.unique(['provider', 'provider_account_id'], 'uq_user_auth_accounts_provider_account');
    table.index(['tenant', 'provider'], 'idx_user_auth_accounts_tenant_provider');
    table.index(['user_id', 'provider'], 'idx_user_auth_accounts_user_provider');
  });

exports.up = async function up(knex) {
  await ensureTable(knex, TABLE_NAME, () => createUserAuthAccountsTable(knex));
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
