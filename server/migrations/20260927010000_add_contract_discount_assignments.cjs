'use strict';

/** Reusable discount definitions may be assigned directly to client contracts. */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contract_discount_assignments'))) {
    await knex.schema.createTable('contract_discount_assignments', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('assignment_id').notNullable();
      table.uuid('contract_id').notNullable();
      table.uuid('discount_id').notNullable();
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'assignment_id']);
      table.unique(['tenant', 'contract_id', 'discount_id'], 'uq_contract_discount_assignments');
      table.foreign(['tenant']).references(['tenant']).inTable('tenants').onDelete('CASCADE');
      table.foreign(['tenant', 'contract_id']).references(['tenant', 'contract_id']).inTable('contracts').onDelete('CASCADE');
      table.foreign(['tenant', 'discount_id']).references(['tenant', 'discount_id']).inTable('discounts').onDelete('CASCADE');
      table.index(['tenant', 'contract_id'], 'idx_contract_discount_assignments_contract');
    });
  }

  // Citus tables referenced by FKs must share tenant colocation. The table is
  // empty when first distributed, and the relation guard keeps CE on plain
  // Postgres working without a Citus dependency.
  const hasCitus = await knex.raw("SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS present");
  if (!hasCitus.rows?.[0]?.present) return;
  const alreadyDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'public.contract_discount_assignments'::regclass
    ) AS present
  `);
  if (!alreadyDistributed.rows?.[0]?.present) {
    await knex.raw("SELECT create_distributed_table('contract_discount_assignments', 'tenant', colocate_with => 'contracts')");
  }
  // Be safe if a previous migration attempt distributed this table after rows
  // had been written locally: discard only the invisible parent heap copy.
  await knex.raw("SELECT truncate_local_data_after_distributing_table('public.contract_discount_assignments')");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_discount_assignments');
};
