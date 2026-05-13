/**
 * Link outbound email logs to first-class comment threads.
 *
 * The existing email_sending_logs.thread_id column is provider-owned thread
 * identity and is intentionally left unchanged for compatibility.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const hasTenant = await knex.schema.hasColumn('email_sending_logs', 'tenant');
  const hasTenantId = await knex.schema.hasColumn('email_sending_logs', 'tenant_id');
  const tenantColumn = hasTenant ? 'tenant' : hasTenantId ? 'tenant_id' : null;

  if (!tenantColumn) {
    throw new Error('email_sending_logs is missing both tenant and tenant_id columns');
  }

  const hasCommentThreadId = await knex.schema.hasColumn('email_sending_logs', 'comment_thread_id');
  if (!hasCommentThreadId) {
    await knex.schema.alterTable('email_sending_logs', (table) => {
      table.uuid('comment_thread_id').nullable();
    });
  }

  await knex.schema.alterTable('email_sending_logs', (table) => {
    table
      .foreign([tenantColumn, 'comment_thread_id'], 'email_sending_logs_comment_thread_fk')
      .references(['tenant', 'thread_id'])
      .inTable('comment_threads');
  });

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS idx_email_sending_logs_tenant_comment_thread
    ON email_sending_logs (${tenantColumn}, comment_thread_id, created_at DESC)
    WHERE comment_thread_id IS NOT NULL
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  const hasTenant = await knex.schema.hasColumn('email_sending_logs', 'tenant');
  const hasTenantId = await knex.schema.hasColumn('email_sending_logs', 'tenant_id');
  const tenantColumn = hasTenant ? 'tenant' : hasTenantId ? 'tenant_id' : null;

  await knex.schema.raw('DROP INDEX IF EXISTS idx_email_sending_logs_tenant_comment_thread');

  const hasCommentThreadId = await knex.schema.hasColumn('email_sending_logs', 'comment_thread_id');
  if (hasCommentThreadId && tenantColumn) {
    await knex.schema.alterTable('email_sending_logs', (table) => {
      table.dropForeign([tenantColumn, 'comment_thread_id'], 'email_sending_logs_comment_thread_fk');
      table.dropColumn('comment_thread_id');
    });
  }
};
