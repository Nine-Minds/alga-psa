/**
 * Migration 1: Company → Client Rename - Base Migration
 *
 * This migration creates new client-related tables and adds client_id columns
 * to all dependent tables while keeping the old company tables intact.
 *
 * Two-step approach:
 * 1. Create new tables/columns (this migration)
 * 2. Drop old tables/columns (cleanup migration after app cutover)
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('Starting company to client migration...');

  const createdTables = [];
  const addedColumns = [];

  try {
    // Step 1: Create clients table
    const clientsExists = await knex.schema.hasTable('clients');

    if (clientsExists) {
      console.log('clients table already exists, skipping creation...');
    } else {
      console.log('Creating clients table...');
      createdTables.push('clients');
      // Clone structure from companies table
      await knex.schema.createTable('clients', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('client_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.text('client_name').notNullable();
      table.text('url');
      table.boolean('is_inactive').defaultTo(false);
      table.text('payment_terms');
      table.uuid('notes_document_id');
      table.uuid('invoice_template_id');
      table.uuid('billing_contact_id');
      table.uuid('account_manager_id');
      table.text('tax_id_number');
      table.text('region_code');
      table.text('client_type');
      table.text('billing_email');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.primary(['tenant', 'client_id']);
    });

    // Add constraints
    await knex.raw(`
      ALTER TABLE clients
      ADD CONSTRAINT clients_client_id_unique UNIQUE (client_id)
    `);

    await knex.raw(`
      ALTER TABLE clients
      ADD CONSTRAINT clients_tenant_client_name_unique UNIQUE (tenant, client_name)
    `);

    // Add indexes matching companies table
    await knex.raw('CREATE INDEX idx_clients_tenant_client_name ON clients(tenant, client_name)');
    await knex.raw('CREATE INDEX idx_clients_tenant_inactive_name ON clients(tenant, is_inactive, client_name)');
    await knex.raw('CREATE INDEX idx_clients_tenant_client_type ON clients(tenant, client_type)');
    await knex.raw('CREATE INDEX idx_clients_tenant_url ON clients(tenant, url)');

    // Add foreign keys (will be validated after backfill)
    // Skip FK in Citus - it will be added by Citus migration after distribution
    const citusEnabled = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) as enabled
    `);

    if (!citusEnabled.rows[0].enabled) {
      await knex.raw(`
        ALTER TABLE clients
        ADD CONSTRAINT clients_tenant_foreign
        FOREIGN KEY (tenant) REFERENCES tenants(tenant) NOT VALID
      `);
      console.log('✓ Added FK to tenants (non-Citus)');
    } else {
      console.log('⊘ Skipped FK to tenants (Citus - will be added after distribution)');
    }

      console.log('✓ clients table created');
    }

      // Step 2: Backfill clients from companies
    console.log('Backfilling clients from companies...');
    await knex.raw(`
      INSERT INTO clients (
        tenant, client_id, client_name, url, is_inactive, payment_terms,
        notes_document_id, invoice_template_id, billing_contact_id,
        account_manager_id, tax_id_number, region_code, client_type,
        billing_email, created_at, updated_at
      )
      SELECT
        c.tenant, c.company_id, c.company_name, c.url, c.is_inactive, c.payment_terms,
        c.notes_document_id, c.invoice_template_id, c.billing_contact_id,
        c.account_manager_id, c.tax_id_number, c.region_code, c.client_type,
        c.billing_email, c.created_at, c.updated_at
      FROM companies c
      WHERE NOT EXISTS (
        SELECT 1 FROM clients cl
        WHERE cl.tenant = c.tenant AND cl.client_id = c.company_id
      )
    `);

    const count = await knex('clients').count('* as count');
    console.log(`✓ Backfilled ${count[0].count} clients`);

    // Step 3: Create other renamed tables
    await createClientLocations(knex, createdTables);
    await createClientBillingCycles(knex, createdTables);
    await createClientBillingSettings(knex, createdTables);
    await createClientTaxSettings(knex, createdTables);
    await createClientTaxRates(knex, createdTables);

    // Step 4: Add client_id columns to dependent tables
    await addClientIdColumns(knex, addedColumns);

    // Step 5: Backfill client_id from company_id
    await backfillClientIds(knex);

    // Step 6: Verify row counts
    await verifyRowCounts(knex);

    console.log('✓ Company to client migration completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('Rolling back changes...');

    try {
      // Drop created tables in reverse order
      for (const table of createdTables.reverse()) {
        console.log(`  Dropping table: ${table}`);
        await knex.schema.dropTableIfExists(table);
      }

      // Drop added columns
      for (const {table, column} of addedColumns.reverse()) {
        console.log(`  Dropping column: ${table}.${column}`);
        const tableExists = await knex.schema.hasTable(table);
        if (tableExists) {
          const hasColumn = await knex.schema.hasColumn(table, column);
          if (hasColumn) {
            await knex.schema.table(table, (t) => {
              t.dropColumn(column);
            });
          }
        }
      }

      console.log('✓ Rollback completed');
    } catch (rollbackError) {
      console.error('❌ Rollback failed:', rollbackError.message);
      console.error('Manual cleanup may be required!');
    }

    throw error; // Re-throw to mark migration as failed
  }
};

async function createClientLocations(knex, createdTables) {
  const exists = await knex.schema.hasTable('client_locations');
  if (!exists) {
    console.log('Creating client_locations...');
    createdTables.push('client_locations');
    await knex.schema.createTable('client_locations', (table) => {
      table.uuid('location_id').notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('client_id').notNullable();
      table.string('location_name');
      table.string('address_line1').notNullable();
      table.string('address_line2');
      table.string('address_line3');
      table.string('city').notNullable();
      table.string('state_province');
      table.string('postal_code');
      table.string('country_code').notNullable();
      table.string('country_name').notNullable();
      table.string('region_code');
      table.boolean('is_billing_address').defaultTo(false);
      table.boolean('is_shipping_address').defaultTo(false);
      table.boolean('is_default').defaultTo(false);
      table.string('phone');
      table.string('fax');
      table.string('email');
      table.text('notes');
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.primary(['location_id', 'tenant']);
    });

    // Add indexes
    await knex.raw('CREATE INDEX idx_client_locations_tenant_client_id ON client_locations(tenant, client_id)');
    await knex.raw('CREATE INDEX idx_client_locations_tenant_is_default ON client_locations(tenant, is_default)');
    await knex.raw('CREATE INDEX idx_client_locations_tenant_is_active ON client_locations(tenant, is_active)');
    await knex.raw('CREATE INDEX idx_client_locations_default_phone ON client_locations(tenant, client_id, is_default, phone)');
    await knex.raw('CREATE INDEX idx_client_locations_default_address ON client_locations(tenant, client_id, is_default, address_line1)');
  } else {
    console.log('client_locations already exists, skipping creation...');
  }

  // Backfill (always run, idempotent)
  console.log('Backfilling client_locations from company_locations...');
  await knex.raw(`
    INSERT INTO client_locations (
      location_id, tenant, client_id, location_name, address_line1, address_line2,
      address_line3, city, state_province, postal_code, country_code, country_name,
      region_code, is_billing_address, is_shipping_address, is_default,
      phone, fax, email, notes, is_active, created_at, updated_at
    )
    SELECT
      cl.location_id, cl.tenant, cl.company_id, cl.location_name, cl.address_line1, cl.address_line2,
      cl.address_line3, cl.city, cl.state_province, cl.postal_code, cl.country_code, cl.country_name,
      cl.region_code, cl.is_billing_address, cl.is_shipping_address, cl.is_default,
      cl.phone, cl.fax, cl.email, cl.notes, cl.is_active, cl.created_at, cl.updated_at
    FROM company_locations cl
    WHERE NOT EXISTS (
      SELECT 1 FROM client_locations cll
      WHERE cll.location_id = cl.location_id AND cll.tenant = cl.tenant
    )
  `);

  const count = await knex('client_locations').count('* as count');
  console.log(`✓ client_locations has ${count[0].count} rows`);
}

async function createClientBillingCycles(knex, createdTables) {
  const exists = await knex.schema.hasTable('client_billing_cycles');
  if (!exists) {
    console.log('Creating client_billing_cycles...');
    createdTables.push('client_billing_cycles');
    await knex.schema.createTable('client_billing_cycles', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('billing_cycle_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('client_id').notNullable();
      table.string('billing_cycle').notNullable().defaultTo('monthly');
      table.timestamp('effective_date').notNullable().defaultTo(knex.fn.now());
      table.timestamp('period_start_date').notNullable().defaultTo(knex.fn.now());
      table.timestamp('period_end_date');
      table.boolean('is_active').notNullable().defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());

      table.primary(['tenant', 'billing_cycle_id']);
    });
  } else {
    console.log('client_billing_cycles already exists, skipping creation...');
  }

  // Backfill (always run, idempotent)
  console.log('Backfilling client_billing_cycles from company_billing_cycles...');
  await knex.raw(`
    INSERT INTO client_billing_cycles (
      tenant, billing_cycle_id, client_id, billing_cycle, effective_date,
      period_start_date, period_end_date, is_active, created_at, updated_at
    )
    SELECT
      cbc.tenant, cbc.billing_cycle_id, cbc.company_id, cbc.billing_cycle, cbc.effective_date,
      cbc.period_start_date, cbc.period_end_date, cbc.is_active, cbc.created_at, cbc.updated_at
    FROM company_billing_cycles cbc
    WHERE NOT EXISTS (
      SELECT 1 FROM client_billing_cycles cbc2
      WHERE cbc2.tenant = cbc.tenant AND cbc2.billing_cycle_id = cbc.billing_cycle_id
    )
  `);

  const count = await knex('client_billing_cycles').count('* as count');
  console.log(`✓ client_billing_cycles has ${count[0].count} rows`);
}

async function createClientBillingSettings(knex, createdTables) {
  const exists = await knex.schema.hasTable('client_billing_settings');
  if (!exists) {
    console.log('Creating client_billing_settings...');
    createdTables.push('client_billing_settings');
    await knex.schema.createTable('client_billing_settings', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('client_id').notNullable();
      table.text('zero_dollar_invoice_handling').notNullable();
      table.boolean('suppress_zero_dollar_invoices').notNullable();
      table.integer('credit_expiration_days');
      table.specificType('credit_expiration_notification_days', 'integer[]');
      table.boolean('enable_credit_expiration');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'client_id']);
    });
  } else {
    console.log('client_billing_settings already exists, skipping creation...');
  }

  // Backfill (always run, idempotent)
  console.log('Backfilling client_billing_settings from company_billing_settings...');
  await knex.raw(`
    INSERT INTO client_billing_settings (
      tenant, client_id, zero_dollar_invoice_handling, suppress_zero_dollar_invoices,
      credit_expiration_days, credit_expiration_notification_days, enable_credit_expiration,
      created_at, updated_at
    )
    SELECT
      cbs.tenant, cbs.company_id, cbs.zero_dollar_invoice_handling, cbs.suppress_zero_dollar_invoices,
      cbs.credit_expiration_days, cbs.credit_expiration_notification_days, cbs.enable_credit_expiration,
      cbs.created_at, cbs.updated_at
    FROM company_billing_settings cbs
    WHERE NOT EXISTS (
      SELECT 1 FROM client_billing_settings cbs2
      WHERE cbs2.tenant = cbs.tenant AND cbs2.client_id = cbs.company_id
    )
  `);

  const count = await knex('client_billing_settings').count('* as count');
  console.log(`✓ client_billing_settings has ${count[0].count} rows`);
}

async function createClientTaxSettings(knex, createdTables) {
  const exists = await knex.schema.hasTable('client_tax_settings');
  if (!exists) {
    console.log('Creating client_tax_settings...');
    createdTables.push('client_tax_settings');
    await knex.schema.createTable('client_tax_settings', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('client_id').notNullable();
      table.boolean('is_reverse_charge_applicable').defaultTo(false);

      table.primary(['tenant', 'client_id']);
    });
  } else {
    console.log('client_tax_settings already exists, skipping creation...');
  }

  // Backfill (always run, idempotent)
  console.log('Backfilling client_tax_settings from company_tax_settings...');
  await knex.raw(`
    INSERT INTO client_tax_settings (
      tenant, client_id, is_reverse_charge_applicable
    )
    SELECT
      cts.tenant, cts.company_id, cts.is_reverse_charge_applicable
    FROM company_tax_settings cts
    WHERE NOT EXISTS (
      SELECT 1 FROM client_tax_settings cts2
      WHERE cts2.tenant = cts.tenant AND cts2.client_id = cts.company_id
    )
  `);

  const count = await knex('client_tax_settings').count('* as count');
  console.log(`✓ client_tax_settings has ${count[0].count} rows`);
}

async function createClientTaxRates(knex, createdTables) {
  const exists = await knex.schema.hasTable('client_tax_rates');
  if (!exists) {
    console.log('Creating client_tax_rates...');
    createdTables.push('client_tax_rates');
    await knex.schema.createTable('client_tax_rates', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('client_tax_rates_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('client_id').notNullable();
      table.uuid('tax_rate_id').notNullable();
      table.uuid('location_id');
      table.boolean('is_default').notNullable().defaultTo(false);
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

      table.primary(['client_tax_rates_id', 'tenant']);
    });
  } else {
    console.log('client_tax_rates already exists, skipping creation...');
  }

  // Backfill (always run, idempotent)
  console.log('Backfilling client_tax_rates from company_tax_rates...');
  await knex.raw(`
    INSERT INTO client_tax_rates (
      tenant, client_tax_rates_id, client_id, tax_rate_id, location_id,
      is_default, created_at, updated_at
    )
    SELECT
      ctr.tenant, ctr.company_tax_rates_id, ctr.company_id, ctr.tax_rate_id, ctr.location_id,
      ctr.is_default, ctr.created_at, ctr.updated_at
    FROM company_tax_rates ctr
    WHERE NOT EXISTS (
      SELECT 1 FROM client_tax_rates ctr2
      WHERE ctr2.tenant = ctr.tenant AND ctr2.client_tax_rates_id = ctr.company_tax_rates_id
    )
  `);

  const count = await knex('client_tax_rates').count('* as count');
  console.log(`✓ client_tax_rates has ${count[0].count} rows`);
}

async function addClientIdColumns(knex, addedColumns) {
  console.log('Adding client_id columns to dependent tables...');

  const tables = [
    'assets', 'bucket_usage', 'company_billing_plans', 'company_plan_bundles',
    'contacts', 'credit_reconciliation_reports', 'credit_tracking',
    'inbound_ticket_defaults', 'interactions', 'invoices', 'payment_methods',
    'plan_discounts', 'projects', 'tenant_companies', 'tickets',
    'transactions', 'usage_tracking'
  ];

  for (const table of tables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⊘ Table ${table} does not exist, skipping...`);
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, 'client_id');
    if (!hasColumn) {
      console.log(`  Adding client_id to ${table}...`);
      await knex.schema.table(table, (t) => {
        t.uuid('client_id');
      });
      addedColumns.push({ table, column: 'client_id' });
    } else {
      console.log(`  ✓ ${table}.client_id already exists`);
    }
  }

  console.log('✓ Finished adding client_id columns');
}

async function backfillClientIds(knex) {
  console.log('Backfilling client_id columns...');

  const tables = [
    'assets', 'bucket_usage', 'company_billing_plans', 'company_plan_bundles',
    'contacts', 'credit_reconciliation_reports', 'credit_tracking',
    'inbound_ticket_defaults', 'interactions', 'invoices', 'payment_methods',
    'plan_discounts', 'projects', 'tenant_companies', 'tickets',
    'transactions', 'usage_tracking'
  ];

  for (const table of tables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⊘ Table ${table} does not exist, skipping...`);
      continue;
    }

    const hasCompanyId = await knex.schema.hasColumn(table, 'company_id');
    if (!hasCompanyId) {
      console.log(`  ⊘ ${table} has no company_id column, skipping...`);
      continue;
    }

    console.log(`  Backfilling ${table}.client_id...`);
    const result = await knex.raw(`
      UPDATE ${table}
      SET client_id = company_id
      WHERE client_id IS NULL AND company_id IS NOT NULL
    `);
    console.log(`    ✓ Updated ${result.rowCount || 0} rows`);
  }

  console.log('✓ Finished backfilling client_id columns');
}

async function verifyRowCounts(knex) {
  console.log('\nVerifying row counts...');

  // Verify main table
  const companiesCount = await knex('companies').count('* as count');
  const clientsCount = await knex('clients').count('* as count');

  if (companiesCount[0].count !== clientsCount[0].count) {
    throw new Error(`Row count mismatch: companies=${companiesCount[0].count}, clients=${clientsCount[0].count}`);
  }
  console.log(`  ✓ clients: ${clientsCount[0].count} rows match companies`);

  // Verify related tables
  const relatedTables = [
    { old: 'company_locations', new: 'client_locations' },
    { old: 'company_billing_cycles', new: 'client_billing_cycles' },
    { old: 'company_billing_settings', new: 'client_billing_settings' },
    { old: 'company_tax_settings', new: 'client_tax_settings' },
    { old: 'company_tax_rates', new: 'client_tax_rates' }
  ];

  for (const { old: oldTable, new: newTable } of relatedTables) {
    const oldTableExists = await knex.schema.hasTable(oldTable);
    const newTableExists = await knex.schema.hasTable(newTable);

    if (!oldTableExists || !newTableExists) {
      console.log(`  ⊘ Skipping ${oldTable} → ${newTable} (table missing)`);
      continue;
    }

    const oldCount = await knex(oldTable).count('* as count');
    const newCount = await knex(newTable).count('* as count');

    if (oldCount[0].count !== newCount[0].count) {
      throw new Error(`Row count mismatch: ${oldTable}=${oldCount[0].count}, ${newTable}=${newCount[0].count}`);
    }
    console.log(`  ✓ ${newTable}: ${newCount[0].count} rows match ${oldTable}`);
  }

  console.log('\n✓ All row count verifications passed');
}

exports.down = async function(knex) {
  console.log('Rolling back company to client migration...');

  // Drop new tables
  await knex.schema.dropTableIfExists('client_tax_rates');
  await knex.schema.dropTableIfExists('client_tax_settings');
  await knex.schema.dropTableIfExists('client_billing_settings');
  await knex.schema.dropTableIfExists('client_billing_cycles');
  await knex.schema.dropTableIfExists('client_locations');
  await knex.schema.dropTableIfExists('clients');

  // Drop client_id columns
  const tables = [
    'assets', 'bucket_usage', 'company_billing_plans', 'company_plan_bundles',
    'contacts', 'credit_reconciliation_reports', 'credit_tracking',
    'inbound_ticket_defaults', 'interactions', 'invoices', 'payment_methods',
    'plan_discounts', 'projects', 'tenant_companies', 'tickets',
    'transactions', 'usage_tracking'
  ];

  for (const table of tables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) continue;

    const hasColumn = await knex.schema.hasColumn(table, 'client_id');
    if (hasColumn) {
      await knex.schema.table(table, (t) => {
        t.dropColumn('client_id');
      });
    }
  }

  console.log('✓ Rollback completed');
};
