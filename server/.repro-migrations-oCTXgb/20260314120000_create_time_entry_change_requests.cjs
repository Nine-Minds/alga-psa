/**
 * Stores approver-authored change requests for individual time entries.
 * Preserves review history across repeated change-request cycles.
 */

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('time_entry_change_requests');
  if (!hasTable) {
    await knex.schema.createTable('time_entry_change_requests', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('change_request_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('time_sheet_id').notNullable();
      table.uuid('time_entry_id').notNullable();
      table.uuid('created_by').notNullable();
      table.text('comment').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.uuid('handled_by').nullable();
      table.timestamp('handled_at').nullable();

      table.primary(['change_request_id', 'tenant'], {
        constraintName: 'time_entry_change_requests_pk',
      });
    });
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS time_entry_change_requests_entry_created_idx
      ON time_entry_change_requests (tenant, time_entry_id, created_at DESC);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS time_entry_change_requests_sheet_idx
      ON time_entry_change_requests (tenant, time_sheet_id);
  `);

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS time_entry_change_requests_unresolved_idx
      ON time_entry_change_requests (tenant, time_entry_id, handled_at, created_at DESC);
  `);

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') as enabled
  `);

  if (citusEnabled.rows?.[0]?.enabled) {
    const isDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = 'time_entry_change_requests'::regclass
      ) as distributed
    `);

    if (!isDistributed.rows?.[0]?.distributed) {
      await knex.raw(`
        SELECT create_distributed_table('time_entry_change_requests', 'tenant', colocate_with => 'tenants')
      `);
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('time_entry_change_requests');
};

exports.config = { transaction: false };
