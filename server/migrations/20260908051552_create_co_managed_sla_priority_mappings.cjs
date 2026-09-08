const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_sla_priority_mappings';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('customer_tenant').notNullable();
    table.uuid('relationship_id').notNullable();
    table.uuid('customer_priority_id').notNullable();
    table.uuid('msp_priority_id').notNullable();
    table.primary(['tenant', 'customer_tenant', 'relationship_id', 'customer_priority_id']);
    table.check('tenant <> customer_tenant');
  });
  await ensureTenantDistribution(knex, TABLE);
  for (const [name, columns, parent, parentColumns] of [
    ['co_sla_mapping_owner_fk', ['tenant'], 'tenants', ['tenant']],
    ['co_sla_mapping_priority_fk', ['tenant', 'msp_priority_id'], 'priorities', ['tenant', 'priority_id']],
  ]) if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.schema.alterTable(TABLE, builder => builder.foreign(columns, name).references(parentColumns).inTable(parent).onDelete('CASCADE'));
  }
};
exports.down = async function(knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot remove configured co-managed SLA mappings');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
