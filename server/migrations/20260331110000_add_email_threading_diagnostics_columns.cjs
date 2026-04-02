/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTenant = await knex.schema.hasColumn('email_sending_logs', 'tenant');
  const hasTenantId = await knex.schema.hasColumn('email_sending_logs', 'tenant_id');
  const tenantColumn = hasTenant ? 'tenant' : hasTenantId ? 'tenant_id' : null;

  if (!tenantColumn) {
    throw new Error('email_sending_logs is missing both tenant and tenant_id columns');
  }

  const columnsToAdd = [
    ['provider_message_id', () => knex.schema.alterTable('email_sending_logs', (table) => table.string('provider_message_id').nullable())],
    ['rfc_message_id', () => knex.schema.alterTable('email_sending_logs', (table) => table.string('rfc_message_id').nullable())],
    ['thread_id', () => knex.schema.alterTable('email_sending_logs', (table) => table.string('thread_id').nullable())],
    ['comment_id', () => knex.schema.alterTable('email_sending_logs', (table) => table.uuid('comment_id').nullable())],
    ['reply_token_hash', () => knex.schema.alterTable('email_sending_logs', (table) => table.string('reply_token_hash', 64).nullable())],
    ['reply_token_suffix', () => knex.schema.alterTable('email_sending_logs', (table) => table.string('reply_token_suffix', 16).nullable())],
  ];

  for (const [columnName, addColumn] of columnsToAdd) {
    const hasColumn = await knex.schema.hasColumn('email_sending_logs', columnName);
    if (!hasColumn) {
      await addColumn();
    }
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_sending_logs_tenant_provider_message
    ON email_sending_logs (${tenantColumn}, provider_message_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_sending_logs_tenant_rfc_message
    ON email_sending_logs (${tenantColumn}, rfc_message_id)
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_sending_logs_tenant_reply_token_hash
    ON email_sending_logs (${tenantColumn}, reply_token_hash)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_email_sending_logs_tenant_reply_token_hash');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_email_sending_logs_tenant_rfc_message');
  await knex.schema.raw('DROP INDEX IF EXISTS idx_email_sending_logs_tenant_provider_message');

  const columnsToDrop = [
    'reply_token_suffix',
    'reply_token_hash',
    'comment_id',
    'thread_id',
    'rfc_message_id',
    'provider_message_id',
  ];

  for (const columnName of columnsToDrop) {
    const hasColumn = await knex.schema.hasColumn('email_sending_logs', columnName);
    if (hasColumn) {
      await knex.schema.alterTable('email_sending_logs', (table) => {
        table.dropColumn(columnName);
      });
    }
  }
};

exports.config = { transaction: false };
