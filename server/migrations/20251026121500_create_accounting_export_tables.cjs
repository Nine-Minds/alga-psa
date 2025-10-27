/**
 * Migration: create canonical accounting export tables (batches, lines, errors)
 * with tenant isolation and supporting indexes.
 */

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const hasBatches = await knex.schema.hasTable('accounting_export_batches');
  if (!hasBatches) {
    await knex.schema.createTable('accounting_export_batches', (table) => {
      table.uuid('batch_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.string('adapter_type', 50).notNullable(); // e.g., quickbooks_online, quickbooks_desktop, xero
      table.string('target_realm', 255).nullable(); // Realm/company identifier in target accounting system
      table.string('export_type', 50).notNullable().defaultTo('invoice');
      table.jsonb('filters').nullable();
      table.string('status', 30).notNullable().defaultTo('pending');
      table.timestamp('queued_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('validated_at', { useTz: true }).nullable();
      table.timestamp('delivered_at', { useTz: true }).nullable();
      table.timestamp('posted_at', { useTz: true }).nullable();
      table.uuid('created_by').nullable();
      table.uuid('last_updated_by').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.text('notes').nullable();

      table.foreign('tenant').references('tenant').inTable('tenants');
      table.index(['tenant', 'status'], 'accounting_export_batches_tenant_status_idx');
      table.index(['tenant', 'adapter_type'], 'accounting_export_batches_adapter_idx');
    });
  }

  const hasLines = await knex.schema.hasTable('accounting_export_lines');
  if (!hasLines) {
    await knex.schema.createTable('accounting_export_lines', (table) => {
      table.uuid('line_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('batch_id').notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('invoice_id').notNullable();
      table.uuid('invoice_charge_id').nullable();
      table.uuid('client_id').nullable();
      table.integer('amount_cents').notNullable();
      table.string('currency_code', 3).notNullable();
      table.integer('exchange_rate_basis_points').nullable();
      table.timestamp('service_period_start', { useTz: true }).nullable();
      table.timestamp('service_period_end', { useTz: true }).nullable();
      table.jsonb('mapping_resolution').nullable();
      table.jsonb('payload').nullable(); // Canonical data snapshot
      table.string('status', 30).notNullable().defaultTo('pending');
      table.text('external_document_ref').nullable();
      table.text('notes').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.foreign('batch_id').references('batch_id').inTable('accounting_export_batches').onDelete('CASCADE');
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.foreign(['tenant', 'invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices');
      table.index(['batch_id', 'status'], 'accounting_export_lines_batch_status_idx');
      table.index(['tenant', 'invoice_id'], 'accounting_export_lines_invoice_idx');
    });
  }

  const hasErrors = await knex.schema.hasTable('accounting_export_errors');
  if (!hasErrors) {
    await knex.schema.createTable('accounting_export_errors', (table) => {
      table.uuid('error_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('batch_id').notNullable();
      table.uuid('line_id').nullable();
      table.uuid('tenant').notNullable();
      table.string('code', 100).notNullable();
      table.text('message').notNullable();
      table.jsonb('metadata').nullable();
      table.string('resolution_state', 30).notNullable().defaultTo('open');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('resolved_at', { useTz: true }).nullable();

      table.foreign('batch_id').references('batch_id').inTable('accounting_export_batches').onDelete('CASCADE');
      table.foreign('line_id').references('line_id').inTable('accounting_export_lines').onDelete('SET NULL');
      table.foreign('tenant').references('tenant').inTable('tenants');
      table.index(['tenant', 'resolution_state'], 'accounting_export_errors_state_idx');
    });
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('accounting_export_errors');
  await knex.schema.dropTableIfExists('accounting_export_lines');
  await knex.schema.dropTableIfExists('accounting_export_batches');
};
