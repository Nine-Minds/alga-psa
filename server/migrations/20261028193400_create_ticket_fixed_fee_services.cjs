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
  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, 'ticket_fixed_fee_services');
  async function ensureForeignKey(name, create) {
    const result = await knex.raw(
      'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
      [name, 'ticket_fixed_fee_services'],
    );
    if (result.rows.length === 0) {
      await create();
    }
  }
  await ensureForeignKey('ticket_fixed_fee_tenant_fk', () => knex.raw(
    'ALTER TABLE ticket_fixed_fee_services ADD CONSTRAINT ticket_fixed_fee_tenant_fk FOREIGN KEY (tenant) REFERENCES tenants(tenant)',
  ));
  await ensureForeignKey('ticket_fixed_fee_ticket_fk', () => knex.raw(
    'ALTER TABLE ticket_fixed_fee_services ADD CONSTRAINT ticket_fixed_fee_ticket_fk FOREIGN KEY (tenant, ticket_id) REFERENCES tickets(tenant, ticket_id) ON DELETE CASCADE',
  ));
  await ensureForeignKey('ticket_fixed_fee_client_fk', () => knex.raw(
    'ALTER TABLE ticket_fixed_fee_services ADD CONSTRAINT ticket_fixed_fee_client_fk FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id) ON DELETE RESTRICT',
  ));
  await ensureForeignKey('ticket_fixed_fee_service_fk', () => knex.raw(
    'ALTER TABLE ticket_fixed_fee_services ADD CONSTRAINT ticket_fixed_fee_service_fk FOREIGN KEY (tenant, service_id) REFERENCES service_catalog(tenant, service_id) ON DELETE RESTRICT',
  ));
};

exports.config = { transaction: false };

exports.down = async function down(knex) {
  await knex.schema.dropTable('ticket_fixed_fee_services');
};
