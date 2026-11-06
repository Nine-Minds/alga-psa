const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');
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
  await ensureCompositeFk(knex, { table: TABLE, constraint: 'co_sla_mapping_owner_fk', columns: ['tenant'],
    referencedTable: 'tenants', referencedColumns: ['tenant'], onDelete: 'CASCADE' });
  await ensureCompositeFk(knex, { table: TABLE, constraint: 'co_sla_mapping_priority_fk', columns: ['tenant', 'msp_priority_id'],
    referencedTable: 'priorities', referencedColumns: ['tenant', 'priority_id'], onDelete: 'CASCADE' });
};
exports.down = async function(knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot remove configured co-managed SLA mappings');
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };
