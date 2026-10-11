'use strict';

/** Create legacy contract attachments; subsequent migrations assign independent client ownership. */
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
      table.index(['tenant', 'contract_id'], 'idx_contract_discount_assignments_contract');
    });
  }

  // Citus tables referenced by FKs must share tenant colocation. The table is
  // empty when first distributed, and the relation guard keeps CE on plain
  // Postgres working without a Citus dependency.
  const hasCitus = await knex.raw("SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS present");
  if (hasCitus.rows?.[0]?.present) {
    // Reference-table foreign keys must share a sequential Citus transaction.
    await knex.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = 'public.contract_discount_assignments'::regclass
      ) AS present
    `);
    if (!alreadyDistributed.rows?.[0]?.present) {
      await knex.raw("SELECT create_distributed_table('contract_discount_assignments', 'tenant', colocate_with => 'contracts')");
    }
    await knex.raw("SELECT truncate_local_data_after_distributing_table('public.contract_discount_assignments')");
  }
  // Citus disallows a local child's FK to distributed parents. Install the
  // relationships only after the child has been distributed and colocated.
  const relationships = [
    { columns: ['tenant'], parent: 'tenants' },
    { columns: ['tenant', 'discount_id'], parent: 'discounts' },
  ];
  if (await knex.schema.hasColumn('contract_discount_assignments', 'contract_id')) {
    relationships.push({ columns: ['tenant', 'contract_id'], parent: 'contracts' });
  }
  for (const { columns, parent } of relationships) {
    const name = `contract_discount_assignments_${columns.join('_')}_foreign`;
    const existing = await knex.raw("SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contract_discount_assignments'::regclass AND conname = ?", [name]);
    if (existing.rows.length === 0) {
      await knex.schema.alterTable('contract_discount_assignments', (table) => {
        table.foreign(columns, name).references(columns).inTable(parent).onDelete('CASCADE');
      });
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_discount_assignments');
};
