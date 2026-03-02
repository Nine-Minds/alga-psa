/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('document_share_access_log'))) {
    await knex.schema.createTable('document_share_access_log', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('access_log_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('share_id').notNullable();

      // Access details
      table.timestamp('accessed_at', { useTz: true }).defaultTo(knex.fn.now());
      table.text('ip_address');
      table.text('user_agent');
      table.uuid('user_id'); // Only set for portal_authenticated shares

      // Access type: 'view' | 'download' | 'info'
      table.text('access_type').notNullable().defaultTo('download');

      // Whether access was successful or denied (e.g., wrong password, expired)
      table.boolean('was_successful').notNullable().defaultTo(true);
      table.text('failure_reason');

      table.primary(['tenant', 'access_log_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'share_id']).references(['tenant', 'share_id']).inTable('document_share_links');

      // Index for querying access history per share
      table.index(['tenant', 'share_id', 'accessed_at'], 'idx_doc_share_access_log_share_time');
    });
  }

  await distributeIfCitus(knex, 'document_share_access_log');
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('document_share_access_log');
};
