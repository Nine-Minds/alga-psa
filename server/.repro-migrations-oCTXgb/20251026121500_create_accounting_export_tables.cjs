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
      table.uuid('batch_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
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

      table.primary(['tenant', 'batch_id']);
      table.index(['tenant', 'status'], 'accounting_export_batches_tenant_status_idx');
      table.index(['tenant', 'adapter_type'], 'accounting_export_batches_adapter_idx');
      table.index(['tenant', 'created_at'], 'accounting_export_batches_tenant_created_idx');
    });
  }

  const hasLines = await knex.schema.hasTable('accounting_export_lines');
  if (!hasLines) {
    await knex.schema.createTable('accounting_export_lines', (table) => {
      table.uuid('line_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
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

      table.primary(['tenant', 'line_id']);
      table.index(['tenant', 'batch_id'], 'accounting_export_lines_tenant_batch_idx');
      table.index(['tenant', 'batch_id', 'status'], 'accounting_export_lines_tenant_batch_status_idx');
      table.index(['tenant', 'status'], 'accounting_export_lines_tenant_status_idx');
      table.index(['tenant', 'invoice_id'], 'accounting_export_lines_tenant_invoice_idx');
      // Multiple export lines may reference the same invoice, so keep these composite indexes non-unique.
      table.index(['tenant', 'invoice_id', 'invoice_charge_id'], 'accounting_export_lines_tenant_invoice_charge_idx');
    });
  }

  const hasErrors = await knex.schema.hasTable('accounting_export_errors');
  if (!hasErrors) {
    await knex.schema.createTable('accounting_export_errors', (table) => {
      table.uuid('error_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('batch_id').notNullable();
      table.uuid('line_id').nullable();
      table.uuid('tenant').notNullable();
      table.string('code', 100).notNullable();
      table.text('message').notNullable();
      table.jsonb('metadata').nullable();
      table.string('resolution_state', 30).notNullable().defaultTo('open');
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('resolved_at', { useTz: true }).nullable();

      table.primary(['tenant', 'error_id']);
      table.index(['tenant', 'batch_id'], 'accounting_export_errors_tenant_batch_idx');
      table.index(['tenant', 'line_id'], 'accounting_export_errors_tenant_line_idx');
      table.index(['tenant', 'resolution_state'], 'accounting_export_errors_state_idx');
    });
  }

  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  const citusAvailable = citusFn.rows?.[0]?.exists ?? citusFn[0]?.exists ?? false;

  if (citusAvailable) {
    await distributeTable(knex, 'accounting_export_batches');
    await distributeTable(knex, 'accounting_export_lines');
    await distributeTable(knex, 'accounting_export_errors');
  } else {
    console.warn('[accounting_export_tables] Skipping create_distributed_table calls (function unavailable)');
  }

  // Row level security is managed elsewhere; no automatic policies applied here.
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('accounting_export_errors');
  await knex.schema.dropTableIfExists('accounting_export_lines');
  await knex.schema.dropTableIfExists('accounting_export_batches');
};

async function distributeTable(knex, tableName) {
  await knex.raw(`
    DO $distribution$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) THEN
        PERFORM create_distributed_table('${tableName}', 'tenant');
      END IF;
    END;
    $distribution$;
  `);
}

exports.config = { transaction: false };
