// migration-lint: allow 6 - This filename has already been applied on rolling and must remain in Knex history.
const { ensureTenantDistribution, ensureCompositeFk, hasConstraint } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  if (!await knex.schema.hasTable('ticket_fixed_fee_services')) {
    await knex.schema.createTable('ticket_fixed_fee_services', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('entry_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('ticket_id').notNullable();
      table.uuid('client_id').notNullable();
      table.uuid('service_id').notNullable();
      table.integer('quantity').notNullable();
      table.bigInteger('rate').notNullable();
      table.text('currency_code').notNullable();
      table.text('description').nullable();
      table.boolean('is_billed').notNullable().defaultTo(false);
      table.uuid('billed_invoice_id').nullable();
      table.timestamp('billed_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'entry_id']);
      table.check('quantity > 0');
      table.check('rate >= 0');
      table.check("currency_code ~ '^[A-Z]{3}$'");
      table.index(['tenant', 'ticket_id', 'is_billed', 'created_at'], 'ticket_fixed_fee_ticket_unbilled_idx');
      table.index(['tenant', 'client_id', 'is_billed', 'created_at'], 'ticket_fixed_fee_client_unbilled_idx');
      table.index(['tenant', 'billed_invoice_id'], 'ticket_fixed_fee_invoice_idx');
    });
  }
  await ensureTenantDistribution(knex, 'ticket_fixed_fee_services');
  if (!await hasConstraint(knex, 'ticket_fixed_fee_services', 'ticket_fixed_fee_tenant_fk')) {
    await knex.raw(
      'ALTER TABLE ticket_fixed_fee_services ADD CONSTRAINT ticket_fixed_fee_tenant_fk FOREIGN KEY (tenant) REFERENCES tenants(tenant)',
    );
  }
  for (const { constraint, column, referencedTable, onDelete } of [
    { constraint: 'ticket_fixed_fee_ticket_fk', column: 'ticket_id', referencedTable: 'tickets', onDelete: 'CASCADE' },
    { constraint: 'ticket_fixed_fee_client_fk', column: 'client_id', referencedTable: 'clients', onDelete: 'RESTRICT' },
    { constraint: 'ticket_fixed_fee_service_fk', column: 'service_id', referencedTable: 'service_catalog', onDelete: 'RESTRICT' },
  ]) {
    await ensureCompositeFk(knex, {
      table: 'ticket_fixed_fee_services',
      constraint,
      columns: ['tenant', column],
      referencedTable,
      referencedColumns: ['tenant', column],
      onDelete,
    });
  }
};

exports.config = { transaction: false };

exports.down = async function down(knex) {
  await knex.schema.dropTable('ticket_fixed_fee_services');
};
