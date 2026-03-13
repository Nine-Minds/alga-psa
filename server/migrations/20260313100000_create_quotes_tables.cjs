/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('quotes', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('quote_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('quote_number').nullable();
    table.uuid('client_id').nullable();
    table.uuid('contact_id').nullable();
    table.text('title').notNullable();
    table.text('description').nullable();
    table.timestamp('quote_date', { useTz: true }).nullable();
    table.timestamp('valid_until', { useTz: true }).nullable();
    table.text('status').nullable();
    table.integer('version').notNullable().defaultTo(1);
    table.uuid('parent_quote_id').nullable();
    table.text('po_number').nullable();
    table.bigInteger('subtotal').notNullable().defaultTo(0);
    table.bigInteger('discount_total').notNullable().defaultTo(0);
    table.bigInteger('tax').notNullable().defaultTo(0);
    table.bigInteger('total_amount').notNullable().defaultTo(0);
    table.string('currency_code', 3).notNullable().defaultTo('USD');
    table.text('internal_notes').nullable();
    table.text('client_notes').nullable();
    table.text('terms_and_conditions').nullable();
    table.boolean('is_template').notNullable().defaultTo(false);
    table.uuid('template_id').nullable();
    table.uuid('converted_contract_id').nullable();
    table.uuid('converted_invoice_id').nullable();
    table.timestamp('sent_at', { useTz: true }).nullable();
    table.timestamp('viewed_at', { useTz: true }).nullable();
    table.timestamp('accepted_at', { useTz: true }).nullable();
    table.uuid('accepted_by').nullable();
    table.timestamp('rejected_at', { useTz: true }).nullable();
    table.text('rejection_reason').nullable();
    table.timestamp('cancelled_at', { useTz: true }).nullable();
    table.timestamp('expired_at', { useTz: true }).nullable();
    table.timestamp('converted_at', { useTz: true }).nullable();
    table.timestamp('archived_at', { useTz: true }).nullable();
    table.uuid('opportunity_id').nullable();
    table.uuid('created_by').nullable();
    table.uuid('updated_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'quote_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('SET NULL');
    table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts').onDelete('SET NULL');
    table.foreign(['tenant', 'parent_quote_id']).references(['tenant', 'quote_id']).inTable('quotes').onDelete('SET NULL');
    table.foreign(['tenant', 'converted_contract_id']).references(['tenant', 'contract_id']).inTable('contracts').onDelete('SET NULL');
    table.foreign(['tenant', 'converted_invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices').onDelete('SET NULL');
    table.foreign(['tenant', 'accepted_by']).references(['tenant', 'user_id']).inTable('users').onDelete('SET NULL');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users').onDelete('SET NULL');
    table.foreign(['tenant', 'updated_by']).references(['tenant', 'user_id']).inTable('users').onDelete('SET NULL');
  });

  await knex.raw(`
    ALTER TABLE quotes
    ADD CONSTRAINT quotes_status_check
    CHECK (
      status IS NULL OR status IN (
        'draft',
        'sent',
        'accepted',
        'rejected',
        'expired',
        'converted',
        'cancelled',
        'superseded',
        'archived'
      )
    )
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_quotes_tenant_quote_number
    ON quotes (tenant, quote_number)
    WHERE quote_number IS NOT NULL
  `);
  await knex.raw('CREATE INDEX idx_quotes_tenant_client ON quotes (tenant, client_id)');
  await knex.raw('CREATE INDEX idx_quotes_tenant_status ON quotes (tenant, status)');
  await knex.raw('CREATE INDEX idx_quotes_tenant_parent_quote ON quotes (tenant, parent_quote_id)');

  await knex.schema.createTable('quote_items', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('quote_item_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('quote_id').notNullable();
    table.uuid('service_id').nullable();
    table.text('service_item_kind').nullable();
    table.text('service_name').nullable();
    table.text('service_sku').nullable();
    table.text('billing_method').nullable();
    table.text('description').notNullable();
    table.bigInteger('quantity').notNullable().defaultTo(1);
    table.bigInteger('unit_price').notNullable().defaultTo(0);
    table.bigInteger('total_price').notNullable().defaultTo(0);
    table.bigInteger('tax_amount').notNullable().defaultTo(0);
    table.bigInteger('net_amount').notNullable().defaultTo(0);
    table.text('unit_of_measure').nullable();
    table.integer('display_order').notNullable().defaultTo(0);
    table.text('phase').nullable();
    table.boolean('is_optional').notNullable().defaultTo(false);
    table.boolean('is_selected').notNullable().defaultTo(true);
    table.boolean('is_recurring').notNullable().defaultTo(false);
    table.text('billing_frequency').nullable();
    table.boolean('is_discount').notNullable().defaultTo(false);
    table.text('discount_type').nullable();
    table.integer('discount_percentage').nullable();
    table.uuid('applies_to_item_id').nullable();
    table.uuid('applies_to_service_id').nullable();
    table.boolean('is_taxable').notNullable().defaultTo(true);
    table.text('tax_region').nullable();
    table.integer('tax_rate').nullable();
    table.uuid('created_by').nullable();
    table.uuid('updated_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'quote_item_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'quote_id']).references(['tenant', 'quote_id']).inTable('quotes').onDelete('CASCADE');
    table.foreign(['tenant', 'service_id']).references(['tenant', 'service_id']).inTable('service_catalog').onDelete('SET NULL');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users').onDelete('SET NULL');
    table.foreign(['tenant', 'updated_by']).references(['tenant', 'user_id']).inTable('users').onDelete('SET NULL');
  });

  await knex.raw(`
    ALTER TABLE quote_items
    ADD CONSTRAINT quote_items_discount_type_check
    CHECK (discount_type IS NULL OR discount_type IN ('percentage', 'fixed'))
  `);
  await knex.raw('CREATE INDEX idx_quote_items_tenant_quote_order ON quote_items (tenant, quote_id, display_order)');

  await knex.schema.createTable('quote_activities', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('activity_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('quote_id').notNullable();
    table.text('activity_type').notNullable();
    table.text('description').notNullable();
    table.uuid('performed_by').nullable();
    table.jsonb('metadata').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'activity_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'quote_id']).references(['tenant', 'quote_id']).inTable('quotes').onDelete('CASCADE');
    table.foreign(['tenant', 'performed_by']).references(['tenant', 'user_id']).inTable('users').onDelete('SET NULL');
  });

  await knex.raw('CREATE INDEX idx_quote_activities_tenant_quote_created_at ON quote_activities (tenant, quote_id, created_at)');

  await knex.raw(`
    INSERT INTO next_number (tenant, entity_type, last_number, initial_value, prefix, padding_length)
    SELECT tenant, 'QUOTE', 0, 1, 'Q-', 4
    FROM tenants
    ON CONFLICT (tenant, entity_type) DO NOTHING
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex('next_number').where({ entity_type: 'QUOTE' }).del();
  await knex.schema.dropTableIfExists('quote_activities');
  await knex.schema.dropTableIfExists('quote_items');
  await knex.schema.dropTableIfExists('quotes');
};
