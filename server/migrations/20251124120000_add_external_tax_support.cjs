/**
 * Migration: Add External Tax Support
 *
 * This migration adds database support for delegating tax calculation to external
 * accounting systems (Xero, QuickBooks, etc.) and importing the calculated taxes back.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('Adding external tax support...');

  // B.1.1 Add tax_source column to invoices table
  console.log('  Adding tax_source to invoices...');
  const hasInvoiceTaxSource = await knex.schema.hasColumn('invoices', 'tax_source');
  if (!hasInvoiceTaxSource) {
    await knex.schema.alterTable('invoices', (table) => {
      table.string('tax_source', 20).defaultTo('internal');
    });

    // Add check constraint
    await knex.raw(`
      ALTER TABLE invoices
      ADD CONSTRAINT invoices_tax_source_check
      CHECK (tax_source IN ('internal', 'external', 'pending_external'))
    `);

    await knex.raw(`
      COMMENT ON COLUMN invoices.tax_source IS
      'Source of tax calculation: internal (Alga), external (accounting package), pending_external (awaiting import)'
    `);
  }

  // B.1.2 Add external tax fields to invoice_charges table
  console.log('  Adding external tax fields to invoice_charges...');
  const hasExternalTaxAmount = await knex.schema.hasColumn('invoice_charges', 'external_tax_amount');
  if (!hasExternalTaxAmount) {
    await knex.schema.alterTable('invoice_charges', (table) => {
      table.integer('external_tax_amount').nullable();
      table.string('external_tax_code', 50).nullable();
      table.decimal('external_tax_rate', 5, 2).nullable();
    });

    await knex.raw(`
      COMMENT ON COLUMN invoice_charges.external_tax_amount IS
      'Tax amount calculated by external accounting system (in cents)'
    `);
    await knex.raw(`
      COMMENT ON COLUMN invoice_charges.external_tax_code IS
      'Tax code from external accounting system'
    `);
    await knex.raw(`
      COMMENT ON COLUMN invoice_charges.external_tax_rate IS
      'Tax rate from external accounting system'
    `);
  }

  // B.1.3 Add tax delegation settings to tenant_settings table
  // Note: external_tax_adapter is NOT stored here - the adapter is determined automatically
  // based on which accounting system the invoice is exported to (from tenant_external_entity_mappings)
  console.log('  Adding tax delegation settings to tenant_settings...');
  const hasDefaultTaxSource = await knex.schema.hasColumn('tenant_settings', 'default_tax_source');
  if (!hasDefaultTaxSource) {
    await knex.schema.alterTable('tenant_settings', (table) => {
      table.string('default_tax_source', 20).defaultTo('internal');
      table.boolean('allow_external_tax_override').defaultTo(false);
    });

    await knex.raw(`
      COMMENT ON COLUMN tenant_settings.default_tax_source IS
      'Default tax calculation source for new invoices: internal (Alga calculates) or external (accounting package calculates after export)'
    `);
    await knex.raw(`
      COMMENT ON COLUMN tenant_settings.allow_external_tax_override IS
      'Whether clients can override the default tax source'
    `);
  }

  // B.1.4 Add client-level tax source override to client_tax_settings
  // Note: No adapter override needed - the adapter is determined by which accounting system
  // the invoice is exported to, not by a pre-configured setting
  console.log('  Adding client-level tax source override...');
  const hasTaxSourceOverride = await knex.schema.hasColumn('client_tax_settings', 'tax_source_override');
  if (!hasTaxSourceOverride) {
    await knex.schema.alterTable('client_tax_settings', (table) => {
      table.string('tax_source_override', 20).nullable();
    });

    await knex.raw(`
      COMMENT ON COLUMN client_tax_settings.tax_source_override IS
      'Per-client override of tenant tax source setting (internal or external)'
    `);
  }

  // B.1.5 Create external_tax_imports tracking table
  console.log('  Creating external_tax_imports table...');
  const hasExternalTaxImports = await knex.schema.hasTable('external_tax_imports');
  if (!hasExternalTaxImports) {
    await knex.schema.createTable('external_tax_imports', (table) => {
      table.uuid('import_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable().references('tenant').inTable('tenants');
      table.uuid('invoice_id').notNullable().references('invoice_id').inTable('invoices');
      table.string('adapter_type', 50).notNullable();
      table.string('external_invoice_ref', 255).nullable();
      table.timestamp('imported_at', { useTz: true }).defaultTo(knex.fn.now());
      // imported_by is nullable and references users(user_id) within the same tenant
      // Note: No foreign key constraint since users table has composite primary key (tenant, user_id)
      // Referential integrity is maintained at application level
      table.uuid('imported_by').nullable();
      table.string('import_status', 20).defaultTo('success');
      table.integer('original_internal_tax').nullable();
      table.integer('imported_external_tax').nullable();
      table.integer('tax_difference').nullable();
      table.jsonb('metadata').nullable();
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());

      table.index('invoice_id', 'idx_external_tax_imports_invoice');
      table.index('tenant', 'idx_external_tax_imports_tenant');
    });

    // Add composite foreign key constraint for imported_by
    // Since users table has composite primary key (tenant, user_id), we need to reference both
    // PostgreSQL allows NULL values in foreign key columns, so this works even when imported_by is NULL
    await knex.raw(`
      ALTER TABLE external_tax_imports
      ADD CONSTRAINT external_tax_imports_imported_by_foreign
      FOREIGN KEY (tenant, imported_by)
      REFERENCES users(tenant, user_id)
      ON DELETE SET NULL
    `);

    // Add RLS policy
    await knex.raw(`
      ALTER TABLE external_tax_imports ENABLE ROW LEVEL SECURITY
    `);

    await knex.raw(`
      CREATE POLICY external_tax_imports_tenant_isolation ON external_tax_imports
      FOR ALL
      USING (tenant::text = current_setting('app.current_tenant', true))
      WITH CHECK (tenant::text = current_setting('app.current_tenant', true))
    `);

    await knex.raw(`
      COMMENT ON TABLE external_tax_imports IS
      'Tracks tax imports from external accounting systems for reconciliation and audit'
    `);
  }

  console.log('✓ External tax support added');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log('Removing external tax support...');

  // Remove external_tax_imports table
  console.log('  Dropping external_tax_imports table...');
  const hasExternalTaxImports = await knex.schema.hasTable('external_tax_imports');
  if (hasExternalTaxImports) {
    await knex.raw('DROP POLICY IF EXISTS external_tax_imports_tenant_isolation ON external_tax_imports');
    await knex.schema.dropTable('external_tax_imports');
  }

  // Remove client_tax_settings columns
  console.log('  Removing client-level tax source override column...');
  const hasTaxSourceOverride = await knex.schema.hasColumn('client_tax_settings', 'tax_source_override');
  if (hasTaxSourceOverride) {
    await knex.schema.alterTable('client_tax_settings', (table) => {
      table.dropColumn('tax_source_override');
    });
  }

  // Remove tenant_settings columns
  console.log('  Removing tenant tax delegation settings...');
  const hasDefaultTaxSource = await knex.schema.hasColumn('tenant_settings', 'default_tax_source');
  if (hasDefaultTaxSource) {
    await knex.schema.alterTable('tenant_settings', (table) => {
      table.dropColumn('default_tax_source');
      table.dropColumn('allow_external_tax_override');
    });
  }

  // Remove invoice_charges columns
  console.log('  Removing external tax fields from invoice_charges...');
  const hasExternalTaxAmount = await knex.schema.hasColumn('invoice_charges', 'external_tax_amount');
  if (hasExternalTaxAmount) {
    await knex.schema.alterTable('invoice_charges', (table) => {
      table.dropColumn('external_tax_amount');
      table.dropColumn('external_tax_code');
      table.dropColumn('external_tax_rate');
    });
  }

  // Remove invoices column
  console.log('  Removing tax_source from invoices...');
  const hasInvoiceTaxSource = await knex.schema.hasColumn('invoices', 'tax_source');
  if (hasInvoiceTaxSource) {
    await knex.raw('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_tax_source_check');
    await knex.schema.alterTable('invoices', (table) => {
      table.dropColumn('tax_source');
    });
  }

  console.log('✓ External tax support removed');
};
