const TABLE = 'entra_managed_tenant_user_filters';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('managed_tenant_id').notNullable();
      table.jsonb('filter_config').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.uuid('updated_by').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'managed_tenant_id']);
      table.foreign(['tenant', 'managed_tenant_id']).references(['tenant', 'managed_tenant_id']).inTable('entra_managed_tenants').onDelete('CASCADE');
    });
  }
  const { rows } = await knex.raw("SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table' LIMIT 1");
  if (rows.length) {
    const { rows: distributed } = await knex.raw("SELECT 1 FROM citus_tables WHERE table_name = to_regclass(?) LIMIT 1", [TABLE]);
    if (!distributed.length) await knex.raw("SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'entra_managed_tenants')", [TABLE]);
  }
};

exports.down = async function down(knex) { await knex.schema.dropTableIfExists(TABLE); };
