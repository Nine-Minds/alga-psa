'use strict';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('contract_template_discount_copies'))) {
    // Create without foreign keys: a local table cannot reference distributed
    // parents on Citus. Distribute it before installing the tenant-aware FKs.
    await knex.schema.createTable('contract_template_discount_copies', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('client_contract_id').notNullable();
      table.string('template_discount_key', 200).notNullable();
      table.uuid('discount_id').notNullable();
      table.primary(['tenant', 'client_contract_id', 'template_discount_key']);
      table.unique(['tenant', 'discount_id']);
    });
  }
  const citus = await knex.raw("SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS present");
  if (citus.rows[0].present) {
    const distributed = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'public.contract_template_discount_copies'::regclass) AS present");
    if (!distributed.rows[0].present) {
      const foreignKeys = await knex.raw("SELECT conname FROM pg_constraint WHERE conrelid = 'public.contract_template_discount_copies'::regclass AND contype = 'f'");
      for (const { conname } of foreignKeys.rows) {
        await knex.raw('ALTER TABLE contract_template_discount_copies DROP CONSTRAINT ??', [conname]);
      }
      await knex.raw("SELECT create_distributed_table('public.contract_template_discount_copies', 'tenant', colocate_with => 'public.client_contracts')");
    }
    await knex.raw("SELECT truncate_local_data_after_distributing_table('public.contract_template_discount_copies')");
  }
  for (const [column, parent] of [['client_contract_id', 'client_contracts'], ['discount_id', 'discounts']]) {
    const name = `contract_template_discount_copies_tenant_${column}_foreign`;
    const constraint = await knex.raw("SELECT 1 FROM pg_constraint WHERE conrelid = 'public.contract_template_discount_copies'::regclass AND conname = ?", [name]);
    if (constraint.rows.length === 0) {
      await knex.schema.alterTable('contract_template_discount_copies', (table) => {
        table.foreign(['tenant', column], name).references(['tenant', column]).inTable(parent).onDelete('CASCADE');
      });
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_template_discount_copies');
};
