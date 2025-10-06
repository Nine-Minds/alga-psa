/**
 * Migration 1 Cleanup: Company to Client - Final Cleanup
 *
 * IMPORTANT: Run this ONLY after:
 * - All application code uses client_id instead of company_id
 * - Feature flags fully rolled out
 * - Production verification passes
 * - Dual-write period is complete (1-2 weeks minimum)
 * - All dependent systems updated
 *
 * This migration:
 * 1. Drops company_id columns from all dependent tables
 * 2. Drops old company_* tables (companies, company_locations, etc.)
 * 3. Makes client_id columns NOT NULL where appropriate
 * 4. Adds proper foreign key constraints to new tables
 * 5. Includes verification steps before dropping anything
 *
 * RISK LEVEL: HIGH - This is a one-way migration affecting core entities
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  console.log('='.repeat(80));
  console.log('Starting company to client CLEANUP migration...');
  console.log('WARNING: This migration will DROP old tables and columns!');
  console.log('Ensure dual-write period is complete and application is stable.');
  console.log('='.repeat(80));

  // Step 1: Verify data integrity before cleanup
  await verifyDataIntegrityBeforeCleanup(knex);

  // Step 2: Add foreign key constraints to new tables
  await addForeignKeyConstraints(knex);

  // Step 3: Make client_id columns NOT NULL where appropriate
  await makeClientIdNotNull(knex);

  // Step 3b: Update tenant_companies constraints prior to dropping company_id
  await updateTenantCompaniesConstraints(knex);

  // Step 4: Drop company_id columns from dependent tables
  await dropOldCompanyIdColumns(knex);

  // Step 5: Drop old company_* tables
  await dropOldCompanyTables(knex);

  // Step 6: Final verification
  await finalVerification(knex);

  console.log('='.repeat(80));
  console.log('✓ Company to client cleanup migration completed successfully');
  console.log('='.repeat(80));
};

/**
 * Helper: Verify data integrity before cleanup
 */
async function verifyDataIntegrityBeforeCleanup(knex) {
  console.log('Verifying data integrity before cleanup...');

  // Check that clients and companies have same row counts
  const companiesExists = await knex.schema.hasTable('companies');
  const clientsExists = await knex.schema.hasTable('clients');

  if (!clientsExists) {
    throw new Error('❌ clients table does not exist - cleanup cannot proceed');
  }

  if (companiesExists) {
    const companiesCount = await knex('companies').count('* as count');
    const clientsCount = await knex('clients').count('* as count');

    if (companiesCount[0].count !== clientsCount[0].count) {
      throw new Error(
        `❌ Row count mismatch: companies=${companiesCount[0].count}, clients=${clientsCount[0].count}`
      );
    }
    console.log(`  ✓ Verified: ${clientsCount[0].count} rows in both companies and clients`);
  }

  // Verify all dependent tables have client_id populated
  const dependentTables = [
    'assets', 'bucket_usage', 'company_billing_plans', 'company_plan_bundles',
    'contacts', 'credit_reconciliation_reports', 'credit_tracking',
    'inbound_ticket_defaults', 'interactions', 'invoices', 'payment_methods',
    'plan_discounts', 'projects', 'tenant_companies', 'tickets',
    'transactions', 'usage_tracking'
  ];

  for (const table of dependentTables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⚠ Table ${table} does not exist, skipping verification`);
      continue;
    }

    const hasCompanyId = await knex.schema.hasColumn(table, 'company_id');
    const hasClientId = await knex.schema.hasColumn(table, 'client_id');

    if (!hasClientId && hasCompanyId) {
      throw new Error(`❌ Table ${table} has company_id but not client_id - migration not complete`);
    }

    if (hasCompanyId && hasClientId) {
      // Check for rows where company_id is set but client_id is not
      const missingClientId = await knex(table)
        .whereNotNull('company_id')
        .whereNull('client_id')
        .count('* as count');

      if (parseInt(missingClientId[0].count) > 0) {
        throw new Error(
          `❌ Table ${table} has ${missingClientId[0].count} rows with company_id but no client_id`
        );
      }
      console.log(`  ✓ Verified ${table}: all company_id rows have client_id`);
    }
  }

  console.log('✓ Data integrity verification complete');
}

/**
 * Helper: Add foreign key constraints to new tables
 */
async function addForeignKeyConstraints(knex) {
  console.log('Adding foreign key constraints to new tables...');

  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  const isCitus = citusEnabled.rows[0].enabled;

  // Add FK from clients to tenants (should already exist from Citus migration)
  try {
    console.log('  Checking FK: clients → tenants...');
    const fkExists = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'clients'::regclass
        AND conname = 'clients_tenant_foreign'
      ) as exists
    `);

    if (!fkExists.rows[0].exists) {
      console.log('  Adding FK: clients → tenants...');
      await knex.raw(`
        ALTER TABLE clients
        ADD CONSTRAINT clients_tenant_foreign
        FOREIGN KEY (tenant) REFERENCES tenants(tenant)
      `);
      console.log('    ✓ Added FK: clients → tenants');
    } else {
      console.log('    ✓ FK already exists: clients → tenants');
    }
  } catch (error) {
    console.log(`    - Could not add FK clients → tenants: ${error.message}`);
  }

  // Add FK from client_locations to clients (should already exist from Citus migration)
  const clientLocationsExists = await knex.schema.hasTable('client_locations');
  if (clientLocationsExists) {
    try {
      console.log('  Checking FK: client_locations → clients...');
      const fkExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'client_locations'::regclass
          AND conname = 'client_locations_client_id_tenant_foreign'
        ) as exists
      `);

      if (!fkExists.rows[0].exists) {
        console.log('  Adding FK: client_locations → clients...');
        if (isCitus) {
          await knex.raw(`
            ALTER TABLE client_locations
            ADD CONSTRAINT client_locations_client_id_tenant_foreign
            FOREIGN KEY (client_id, tenant) REFERENCES clients(client_id, tenant) ON DELETE CASCADE
          `);
        } else {
          await knex.raw(`
            ALTER TABLE client_locations
            ADD CONSTRAINT client_locations_client_id_foreign
            FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
          `);
        }
        console.log('    ✓ Added FK: client_locations → clients');
      } else {
        console.log('    ✓ FK already exists: client_locations → clients');
      }
    } catch (error) {
      console.log(`    - Could not add FK: ${error.message}`);
    }
  }

  // Add FK from client_billing_cycles to clients (should already exist from Citus migration)
  const clientBillingCyclesExists = await knex.schema.hasTable('client_billing_cycles');
  if (clientBillingCyclesExists) {
    try {
      console.log('  Checking FK: client_billing_cycles → clients...');
      const fkExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'client_billing_cycles'::regclass
          AND conname = 'client_billing_cycles_client_id_foreign'
        ) as exists
      `);

      if (!fkExists.rows[0].exists) {
        console.log('  Adding FK: client_billing_cycles → clients...');
        if (isCitus) {
          await knex.raw(`
            ALTER TABLE client_billing_cycles
            ADD CONSTRAINT client_billing_cycles_client_id_foreign
            FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id) ON DELETE CASCADE
          `);
        } else {
          await knex.raw(`
            ALTER TABLE client_billing_cycles
            ADD CONSTRAINT client_billing_cycles_client_id_foreign
            FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
          `);
        }
        console.log('    ✓ Added FK: client_billing_cycles → clients');
      } else {
        console.log('    ✓ FK already exists: client_billing_cycles → clients');
      }
    } catch (error) {
      console.log(`    - Could not add FK: ${error.message}`);
    }
  }

  // Add FK from client_billing_settings to clients (should already exist from Citus migration)
  const clientBillingSettingsExists = await knex.schema.hasTable('client_billing_settings');
  if (clientBillingSettingsExists) {
    try {
      console.log('  Checking FK: client_billing_settings → clients...');
      const fkExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'client_billing_settings'::regclass
          AND conname = 'client_billing_settings_tenant_client_id_foreign'
        ) as exists
      `);

      if (!fkExists.rows[0].exists) {
        console.log('  Adding FK: client_billing_settings → clients...');
        if (isCitus) {
          await knex.raw(`
            ALTER TABLE client_billing_settings
            ADD CONSTRAINT client_billing_settings_tenant_client_id_foreign
            FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
          `);
        } else {
          await knex.raw(`
            ALTER TABLE client_billing_settings
            ADD CONSTRAINT client_billing_settings_client_id_foreign
            FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
          `);
        }
        console.log('    ✓ Added FK: client_billing_settings → clients');
      } else {
        console.log('    ✓ FK already exists: client_billing_settings → clients');
      }
    } catch (error) {
      console.log(`    - Could not add FK: ${error.message}`);
    }
  }

  // Add FK from client_tax_settings to clients (should already exist from Citus migration)
  const clientTaxSettingsExists = await knex.schema.hasTable('client_tax_settings');
  if (clientTaxSettingsExists) {
    try {
      console.log('  Checking FK: client_tax_settings → clients...');
      const fkExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'client_tax_settings'::regclass
          AND conname = 'client_tax_settings_client_id_foreign'
        ) as exists
      `);

      if (!fkExists.rows[0].exists) {
        console.log('  Adding FK: client_tax_settings → clients...');
        if (isCitus) {
          await knex.raw(`
            ALTER TABLE client_tax_settings
            ADD CONSTRAINT client_tax_settings_client_id_foreign
            FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
          `);
        } else {
          await knex.raw(`
            ALTER TABLE client_tax_settings
            ADD CONSTRAINT client_tax_settings_client_id_foreign
            FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
          `);
        }
        console.log('    ✓ Added FK: client_tax_settings → clients');
      } else {
        console.log('    ✓ FK already exists: client_tax_settings → clients');
      }
    } catch (error) {
      console.log(`    - Could not add FK: ${error.message}`);
    }
  }

  // Add FK from client_tax_rates to clients (should already exist from Citus migration)
  const clientTaxRatesExists = await knex.schema.hasTable('client_tax_rates');
  if (clientTaxRatesExists) {
    try {
      console.log('  Checking FK: client_tax_rates → clients...');
      const fkExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'client_tax_rates'::regclass
          AND conname = 'client_tax_rates_client_id_foreign'
        ) as exists
      `);

      if (!fkExists.rows[0].exists) {
        console.log('  Adding FK: client_tax_rates → clients...');
        if (isCitus) {
          await knex.raw(`
            ALTER TABLE client_tax_rates
            ADD CONSTRAINT client_tax_rates_client_id_foreign
            FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
          `);
        } else {
          await knex.raw(`
            ALTER TABLE client_tax_rates
            ADD CONSTRAINT client_tax_rates_client_id_foreign
            FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
          `);
        }
        console.log('    ✓ Added FK: client_tax_rates → clients');
      } else {
        console.log('    ✓ FK already exists: client_tax_rates → clients');
      }
    } catch (error) {
      console.log(`    - Could not add FK: ${error.message}`);
    }
  }

  // Add FK from dependent tables to clients
  const dependentTables = [
    'assets', 'bucket_usage', 'contacts', 'credit_reconciliation_reports',
    'credit_tracking', 'inbound_ticket_defaults', 'interactions', 'invoices',
    'payment_methods', 'plan_discounts', 'projects', 'tenant_companies',
    'tickets', 'transactions', 'usage_tracking'
  ];

  for (const table of dependentTables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⚠ Table ${table} does not exist, skipping FK`);
      continue;
    }

    const hasClientId = await knex.schema.hasColumn(table, 'client_id');
    if (!hasClientId) {
      console.log(`  ⚠ Table ${table} does not have client_id column, skipping FK`);
      continue;
    }

    try {
      console.log(`  Checking FK: ${table} → clients...`);
      const fkExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '${table}'::regclass
          AND (conname LIKE '%client_id%' OR conname LIKE '%_tenant_client_id_%')
        ) as exists
      `);

      if (!fkExists.rows[0].exists) {
        console.log(`  Adding FK: ${table} → clients...`);
        const constraintName = `${table}_tenant_client_id_foreign`;
        if (isCitus) {
          await knex.raw(`
            ALTER TABLE ${table}
            ADD CONSTRAINT ${constraintName}
            FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
          `);
        } else {
          await knex.raw(`
            ALTER TABLE ${table}
            ADD CONSTRAINT ${table}_client_id_foreign
            FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
          `);
        }
        console.log(`    ✓ Added FK: ${table} → clients`);
      } else {
        console.log(`    ✓ FK already exists: ${table} → clients`);
      }
    } catch (error) {
      console.log(`    - Could not add FK for ${table}: ${error.message}`);
    }
  }

  // Special cases: company_billing_plans and company_plan_bundles
  // These will be renamed in later migrations, but need FK for now
  const specialCases = ['company_billing_plans', 'company_plan_bundles'];

  for (const table of specialCases) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⚠ Table ${table} does not exist, skipping FK`);
      continue;
    }

    const hasClientId = await knex.schema.hasColumn(table, 'client_id');
    if (!hasClientId) {
      console.log(`  ⚠ Table ${table} does not have client_id column, skipping FK`);
      continue;
    }

    try {
      console.log(`  Checking FK: ${table} → clients...`);
      const fkExists = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = '${table}'::regclass
          AND (conname LIKE '%client_id%' OR conname LIKE '%_tenant_client_id_%')
        ) as exists
      `);

      if (!fkExists.rows[0].exists) {
        console.log(`  Adding FK: ${table} → clients...`);
        const constraintName = `${table}_tenant_client_id_foreign`;
        if (isCitus) {
          await knex.raw(`
            ALTER TABLE ${table}
            ADD CONSTRAINT ${constraintName}
            FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
          `);
        } else {
          await knex.raw(`
            ALTER TABLE ${table}
            ADD CONSTRAINT ${table}_client_id_foreign
            FOREIGN KEY (client_id) REFERENCES clients(client_id) ON DELETE CASCADE
          `);
        }
        console.log(`    ✓ Added FK: ${table} → clients`);
      } else {
        console.log(`    ✓ FK already exists: ${table} → clients`);
      }
    } catch (error) {
      console.log(`    - Could not add FK for ${table}: ${error.message}`);
    }
  }

  console.log('✓ Foreign key constraints added');
}

/**
 * Helper: Make client_id NOT NULL where appropriate
 */
async function makeClientIdNotNull(knex) {
  console.log('Making client_id columns NOT NULL...');

  // Tables where client_id should be NOT NULL
  const requiredClientIdTables = [
    'assets', 'contacts', 'invoices', 'projects', 'tickets', 'tenant_companies'
  ];

  for (const table of requiredClientIdTables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⚠ Table ${table} does not exist, skipping...`);
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, 'client_id');
    if (!hasColumn) {
      console.log(`  ⚠ Table ${table} does not have client_id column, skipping...`);
      continue;
    }

    // Check for NULL values
    const nullCount = await knex(table).whereNull('client_id').count('* as count');
    if (parseInt(nullCount[0].count) > 0) {
      console.log(`  ⚠ Table ${table} has ${nullCount[0].count} NULL client_id values, skipping NOT NULL constraint`);
      continue;
    }

    try {
      console.log(`  Setting client_id NOT NULL in ${table}...`);
      await knex.raw(`ALTER TABLE ${table} ALTER COLUMN client_id SET NOT NULL`);
      console.log(`  ✓ Set client_id NOT NULL in ${table}`);
    } catch (error) {
      console.log(`  ⚠ Could not set NOT NULL on ${table}: ${error.message}`);
    }
  }

  // Some tables may have optional client_id (e.g., bucket_usage, usage_tracking)
  console.log('✓ Completed NOT NULL enforcement (some tables allow NULL by design)');
}

/**
 * Helper: Update tenant_companies primary key and indexes to use client_id
 */
async function updateTenantCompaniesConstraints(knex) {
  const tableExists = await knex.schema.hasTable('tenant_companies');
  if (!tableExists) {
    console.log('tenant_companies table does not exist, skipping constraint refresh');
    return;
  }

  const hasClientId = await knex.schema.hasColumn('tenant_companies', 'client_id');
  if (!hasClientId) {
    console.log('tenant_companies does not have client_id column yet, skipping constraint refresh');
    return;
  }

  console.log('Refreshing tenant_companies constraints...');

  try {
    console.log('  Dropping existing primary key (if any)...');
    await knex.raw('ALTER TABLE tenant_companies DROP CONSTRAINT IF EXISTS tenant_companies_pkey');
  } catch (error) {
    console.log(`  ⚠ Could not drop tenant_companies primary key: ${error.message}`);
  }

  try {
    console.log('  Adding primary key on (tenant, client_id)...');
    await knex.raw('ALTER TABLE tenant_companies ADD CONSTRAINT tenant_companies_pkey PRIMARY KEY (tenant, client_id)');
    console.log('    ✓ tenant_companies primary key updated');
  } catch (error) {
    console.log(`  ⚠ Could not add tenant_companies primary key: ${error.message}`);
  }

  try {
    console.log('  Dropping legacy default-company index if present...');
    await knex.raw('DROP INDEX IF EXISTS idx_tenant_default_company');
  } catch (error) {
    console.log(`  ⚠ Could not drop idx_tenant_default_company: ${error.message}`);
  }

  try {
    console.log('  Creating unique default-client index...');
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_default_client
      ON tenant_companies (tenant)
      WHERE is_default = TRUE
    `);
    console.log('    ✓ Created idx_tenant_default_client');
  } catch (error) {
    console.log(`  ⚠ Could not create idx_tenant_default_client: ${error.message}`);
  }
}

/**
 * Helper: Drop company_id columns from dependent tables
 */
async function dropOldCompanyIdColumns(knex) {
  console.log('Dropping company_id columns from dependent tables...');

  const dependentTables = [
    'assets', 'bucket_usage', 'company_billing_plans', 'company_plan_bundles',
    'contacts', 'credit_reconciliation_reports', 'credit_tracking',
    'inbound_ticket_defaults', 'interactions', 'invoices', 'payment_methods',
    'plan_discounts', 'projects', 'tenant_companies', 'tickets',
    'transactions', 'usage_tracking'
  ];

  for (const table of dependentTables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⚠ Table ${table} does not exist, skipping...`);
      continue;
    }

    const hasCompanyId = await knex.schema.hasColumn(table, 'company_id');
    if (!hasCompanyId) {
      console.log(`  ✓ Table ${table} already has company_id dropped`);
      continue;
    }

    // Drop any foreign key constraints on company_id first
    try {
      const fks = await knex.raw(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = '${table}'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name LIKE '%company_id%'
        AND table_schema = current_schema()
      `);

      for (const fk of fks.rows) {
        console.log(`    Dropping FK constraint ${fk.constraint_name}...`);
        await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
      }
    } catch (error) {
      console.log(`    - Could not drop FK constraints: ${error.message}`);
    }

    // Drop the column
    try {
      console.log(`  Dropping company_id from ${table}...`);
      await knex.schema.table(table, (t) => {
        t.dropColumn('company_id');
      });
      console.log(`  ✓ Dropped company_id from ${table}`);
    } catch (error) {
      console.log(`  ⚠ Could not drop company_id from ${table}: ${error.message}`);
    }
  }

  console.log('✓ Old company_id columns dropped');
}

/**
 * Helper: Drop old company_* tables
 */
async function dropOldCompanyTables(knex) {
  console.log('Dropping old company_* tables...');

  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  const isCitus = citusEnabled.rows[0].enabled;

  // Drop in order of dependencies (child tables first, parent tables last)
  const tablesToDrop = [
    'company_tax_rates',
    'company_tax_settings',
    'company_billing_settings',
    'company_billing_cycles',
    'company_locations',
    'companies'
  ];

  for (const tableName of tablesToDrop) {
    const exists = await knex.schema.hasTable(tableName);
    if (!exists) {
      console.log(`  ✓ ${tableName} already dropped`);
      continue;
    }

    // If Citus, check if distributed and undistribute first
    if (isCitus) {
      try {
        const isDistributed = await knex.raw(`
          SELECT EXISTS (
            SELECT 1 FROM pg_dist_partition
            WHERE logicalrelid = '${tableName}'::regclass
          ) as distributed
        `);

        if (isDistributed.rows[0].distributed) {
          console.log(`  Undistributing ${tableName}...`);
          await knex.raw(`SELECT undistribute_table('${tableName}', cascade_via_foreign_keys=>true)`);
        }
      } catch (error) {
        console.log(`    - Could not check/undistribute ${tableName}: ${error.message}`);
      }
    }

    // Drop the table
    try {
      console.log(`  Dropping ${tableName}...`);
      await knex.schema.dropTableIfExists(tableName);
      console.log(`  ✓ Dropped ${tableName}`);
    } catch (error) {
      console.log(`  ⚠ Could not drop ${tableName}: ${error.message}`);
    }
  }

  console.log('✓ Old company_* tables dropped');
}

/**
 * Helper: Final verification
 */
async function finalVerification(knex) {
  console.log('='.repeat(80));
  console.log('FINAL VERIFICATION');
  console.log('='.repeat(80));

  // Verify new tables exist
  const clientsExists = await knex.schema.hasTable('clients');
  const clientLocationsExists = await knex.schema.hasTable('client_locations');
  const clientBillingCyclesExists = await knex.schema.hasTable('client_billing_cycles');
  const clientBillingSettingsExists = await knex.schema.hasTable('client_billing_settings');
  const clientTaxSettingsExists = await knex.schema.hasTable('client_tax_settings');
  const clientTaxRatesExists = await knex.schema.hasTable('client_tax_rates');

  console.log(`clients table exists: ${clientsExists ? '✓' : '✗'}`);
  console.log(`client_locations table exists: ${clientLocationsExists ? '✓' : '✗'}`);
  console.log(`client_billing_cycles table exists: ${clientBillingCyclesExists ? '✓' : '✗'}`);
  console.log(`client_billing_settings table exists: ${clientBillingSettingsExists ? '✓' : '✗'}`);
  console.log(`client_tax_settings table exists: ${clientTaxSettingsExists ? '✓' : '✗'}`);
  console.log(`client_tax_rates table exists: ${clientTaxRatesExists ? '✓' : '✗'}`);

  if (!clientsExists) {
    throw new Error('❌ clients table does not exist - cleanup verification failed');
  }

  // Verify old tables are dropped
  const companiesExists = await knex.schema.hasTable('companies');
  const companyLocationsExists = await knex.schema.hasTable('company_locations');
  const companyBillingCyclesExists = await knex.schema.hasTable('company_billing_cycles');
  const companyBillingSettingsExists = await knex.schema.hasTable('company_billing_settings');
  const companyTaxSettingsExists = await knex.schema.hasTable('company_tax_settings');
  const companyTaxRatesExists = await knex.schema.hasTable('company_tax_rates');

  console.log(`companies table dropped: ${!companiesExists ? '✓' : '✗'}`);
  console.log(`company_locations table dropped: ${!companyLocationsExists ? '✓' : '✗'}`);
  console.log(`company_billing_cycles table dropped: ${!companyBillingCyclesExists ? '✓' : '✗'}`);
  console.log(`company_billing_settings table dropped: ${!companyBillingSettingsExists ? '✓' : '✗'}`);
  console.log(`company_tax_settings table dropped: ${!companyTaxSettingsExists ? '✓' : '✗'}`);
  console.log(`company_tax_rates table dropped: ${!companyTaxRatesExists ? '✓' : '✗'}`);

  // Count records in new tables
  if (clientsExists) {
    const clientsCount = await knex('clients').count('* as count');
    console.log(`clients record count: ${clientsCount[0].count}`);
  }

  // Verify dependent tables no longer have company_id
  const dependentTables = [
    'assets', 'bucket_usage', 'contacts', 'invoices', 'projects', 'tickets'
  ];

  for (const table of dependentTables) {
    const tableExists = await knex.schema.hasTable(table);
    if (tableExists) {
      const hasCompanyId = await knex.schema.hasColumn(table, 'company_id');
      const hasClientId = await knex.schema.hasColumn(table, 'client_id');
      console.log(`${table}: company_id dropped=${!hasCompanyId ? '✓' : '✗'}, client_id exists=${hasClientId ? '✓' : '✗'}`);
    }
  }

  console.log('='.repeat(80));
  console.log('✓ FINAL VERIFICATION COMPLETE');
  console.log('='.repeat(80));
}

/**
 * Rollback - WARNING: This is extremely risky and may not fully restore data
 */
exports.down = async function(knex) {
  console.log('='.repeat(80));
  console.log('WARNING: Rollback of cleanup migration is EXTREMELY RISKY');
  console.log('This will attempt to restore old tables but data may be lost');
  console.log('This assumes data is still available in the new tables');
  console.log('='.repeat(80));

  // Restore tenants.client_name back to tenants.company_name if needed
  const tenantHasClientName = await knex.schema.hasColumn('tenants', 'client_name');
  const tenantHasCompanyName = await knex.schema.hasColumn('tenants', 'company_name');

  if (tenantHasClientName && !tenantHasCompanyName) {
    console.log('Renaming tenants.client_name back to tenants.company_name (cleanup rollback)...');
    await knex.raw('ALTER TABLE tenants RENAME COLUMN client_name TO company_name');
    console.log('✓ tenants column restored to company_name');
  }

  // Step 1: Recreate old company_* tables
  await recreateOldCompanyTables(knex);

  // Step 2: Restore company_id columns to dependent tables
  await restoreCompanyIdColumns(knex);

  // Step 3: Backfill old tables from new tables
  await backfillOldTables(knex);

  console.log('='.repeat(80));
  console.log('✓ Rollback completed - Manual verification strongly recommended');
  console.log('='.repeat(80));
};

/**
 * Helper: Recreate old company_* tables
 */
async function recreateOldCompanyTables(knex) {
  console.log('Recreating old company_* tables...');

  // Recreate companies table
  const companiesExists = await knex.schema.hasTable('companies');
  if (!companiesExists) {
    console.log('  Recreating companies table...');
    console.log('  ⚠️ Note: Some columns from the original companies table were moved to');
    console.log('     client_locations and cannot be fully restored (address, city, etc.)');

    await knex.schema.createTable('companies', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('company_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.text('company_name').notNullable();
      table.text('url');
      table.jsonb('properties');
      table.text('billing_type');
      table.text('payment_terms');
      table.bigInteger('credit_limit');
      table.text('preferred_payment_method');
      table.boolean('auto_invoice').defaultTo(false);
      table.text('invoice_delivery_method');
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('updated_at').defaultTo(knex.fn.now());
      table.boolean('is_inactive').defaultTo(false);
      table.text('client_type');
      table.boolean('is_tax_exempt').notNullable().defaultTo(false);
      table.string('tax_exemption_certificate', 255);
      table.string('tax_id_number', 255);
      table.text('notes');
      table.integer('credit_balance');
      table.text('billing_cycle').notNullable().defaultTo('monthly');
      table.string('timezone', 255);
      table.uuid('notes_document_id');
      table.uuid('invoice_template_id');
      table.uuid('billing_contact_id');
      table.string('billing_email', 255);
      table.string('region_code', 255);
      table.uuid('account_manager_id');

      table.primary(['tenant', 'company_id']);
    });

    // Copy data back from clients (only columns that exist in both tables)
    await knex.raw(`
      INSERT INTO companies (
        tenant, company_id, company_name, url, properties, billing_type, payment_terms,
        credit_limit, preferred_payment_method, auto_invoice, invoice_delivery_method,
        created_at, updated_at, is_inactive, client_type, is_tax_exempt,
        tax_exemption_certificate, tax_id_number, notes, credit_balance, billing_cycle,
        timezone, notes_document_id, invoice_template_id, billing_contact_id,
        billing_email, region_code, account_manager_id
      )
      SELECT
        tenant, client_id, client_name, url, properties, billing_type, payment_terms,
        credit_limit, preferred_payment_method, auto_invoice, invoice_delivery_method,
        created_at, updated_at, is_inactive, client_type, is_tax_exempt,
        tax_exemption_certificate, tax_id_number, notes, credit_balance, billing_cycle,
        timezone, notes_document_id, invoice_template_id, billing_contact_id,
        billing_email, region_code, account_manager_id
      FROM clients
    `);
    console.log('    ✓ Restored companies data from clients');
  }

  // Recreate company_locations
  const companyLocationsExists = await knex.schema.hasTable('company_locations');
  if (!companyLocationsExists) {
    console.log('  Recreating company_locations...');
    await knex.schema.createTable('company_locations', (table) => {
      table.uuid('location_id').notNullable();
      table.uuid('tenant').notNullable();
      table.uuid('company_id').notNullable();
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

    // Copy data back
    const clientLocationsExists = await knex.schema.hasTable('client_locations');
    if (clientLocationsExists) {
      await knex.raw(`
        INSERT INTO company_locations
        SELECT
          location_id, tenant, client_id as company_id, location_name,
          address_line1, address_line2, address_line3, city, state_province,
          postal_code, country_code, country_name, region_code,
          is_billing_address, is_shipping_address, is_default,
          phone, fax, email, notes, is_active, created_at, updated_at
        FROM client_locations
      `);
      console.log('    ✓ Restored company_locations data');
    }
  }

  // Recreate other company_* tables following similar pattern
  await recreateCompanyBillingCycles(knex);
  await recreateCompanyBillingSettings(knex);
  await recreateCompanyTaxSettings(knex);
  await recreateCompanyTaxRates(knex);

  console.log('✓ Old company_* tables recreated');
}

async function recreateCompanyBillingCycles(knex) {
  const exists = await knex.schema.hasTable('company_billing_cycles');
  if (exists) return;

  console.log('  Recreating company_billing_cycles...');
  await knex.schema.createTable('company_billing_cycles', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('billing_cycle_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('company_id').notNullable();
    table.string('billing_cycle').notNullable().defaultTo('monthly');
    table.timestamp('effective_date').notNullable().defaultTo(knex.fn.now());
    table.timestamp('period_start_date').notNullable().defaultTo(knex.fn.now());
    table.timestamp('period_end_date');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.primary(['tenant', 'billing_cycle_id']);
  });

  const clientBillingCyclesExists = await knex.schema.hasTable('client_billing_cycles');
  if (clientBillingCyclesExists) {
    await knex.raw(`
      INSERT INTO company_billing_cycles
      SELECT
        tenant, billing_cycle_id, client_id as company_id, billing_cycle,
        effective_date, period_start_date, period_end_date, is_active,
        created_at, updated_at
      FROM client_billing_cycles
    `);
    console.log('    ✓ Restored company_billing_cycles data');
  }
}

async function recreateCompanyBillingSettings(knex) {
  const exists = await knex.schema.hasTable('company_billing_settings');
  if (exists) return;

  console.log('  Recreating company_billing_settings...');
  await knex.schema.createTable('company_billing_settings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('company_id').notNullable();
    table.text('zero_dollar_invoice_handling').notNullable();
    table.boolean('suppress_zero_dollar_invoices').notNullable();
    table.integer('credit_expiration_days');
    table.specificType('credit_expiration_notification_days', 'integer[]');
    table.boolean('enable_credit_expiration');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'company_id']);
  });

  const clientBillingSettingsExists = await knex.schema.hasTable('client_billing_settings');
  if (clientBillingSettingsExists) {
    await knex.raw(`
      INSERT INTO company_billing_settings
      SELECT
        tenant, client_id as company_id, zero_dollar_invoice_handling,
        suppress_zero_dollar_invoices, credit_expiration_days,
        credit_expiration_notification_days, enable_credit_expiration,
        created_at, updated_at
      FROM client_billing_settings
    `);
    console.log('    ✓ Restored company_billing_settings data');
  }
}

async function recreateCompanyTaxSettings(knex) {
  const exists = await knex.schema.hasTable('company_tax_settings');
  if (exists) return;

  console.log('  Recreating company_tax_settings...');
  await knex.schema.createTable('company_tax_settings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('company_id').notNullable();
    table.boolean('is_reverse_charge_applicable').defaultTo(false);

    table.primary(['tenant', 'company_id']);
  });

  const clientTaxSettingsExists = await knex.schema.hasTable('client_tax_settings');
  if (clientTaxSettingsExists) {
    await knex.raw(`
      INSERT INTO company_tax_settings
      SELECT tenant, client_id as company_id, is_reverse_charge_applicable
      FROM client_tax_settings
    `);
    console.log('    ✓ Restored company_tax_settings data');
  }
}

async function recreateCompanyTaxRates(knex) {
  const exists = await knex.schema.hasTable('company_tax_rates');
  if (exists) return;

  console.log('  Recreating company_tax_rates...');
  await knex.schema.createTable('company_tax_rates', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('company_tax_rates_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('company_id').notNullable();
    table.uuid('tax_rate_id').notNullable();
    table.uuid('location_id');
    table.boolean('is_default').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['company_tax_rates_id', 'tenant']);
  });

  const clientTaxRatesExists = await knex.schema.hasTable('client_tax_rates');
  if (clientTaxRatesExists) {
    await knex.raw(`
      INSERT INTO company_tax_rates
      SELECT
        tenant, client_tax_rates_id as company_tax_rates_id,
        client_id as company_id, tax_rate_id, location_id,
        is_default, created_at, updated_at
      FROM client_tax_rates
    `);
    console.log('    ✓ Restored company_tax_rates data');
  }
}

/**
 * Helper: Restore company_id columns to dependent tables
 */
async function restoreCompanyIdColumns(knex) {
  console.log('Restoring company_id columns to dependent tables...');

  const dependentTables = [
    'assets', 'bucket_usage', 'company_billing_plans', 'company_plan_bundles',
    'contacts', 'credit_reconciliation_reports', 'credit_tracking',
    'inbound_ticket_defaults', 'interactions', 'invoices', 'payment_methods',
    'plan_discounts', 'projects', 'tenant_companies', 'tickets',
    'transactions', 'usage_tracking'
  ];

  for (const table of dependentTables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⚠ Table ${table} does not exist, skipping...`);
      continue;
    }

    const hasCompanyId = await knex.schema.hasColumn(table, 'company_id');
    if (hasCompanyId) {
      console.log(`  ✓ Table ${table} already has company_id column`);
      continue;
    }

    console.log(`  Adding company_id to ${table}...`);
    await knex.schema.table(table, (t) => {
      t.uuid('company_id');
    });
  }

  console.log('✓ company_id columns restored');
}

/**
 * Helper: Backfill old tables from new tables
 */
async function backfillOldTables(knex) {
  console.log('Backfilling company_id from client_id in dependent tables...');

  const dependentTables = [
    'assets', 'bucket_usage', 'company_billing_plans', 'company_plan_bundles',
    'contacts', 'credit_reconciliation_reports', 'credit_tracking',
    'inbound_ticket_defaults', 'interactions', 'invoices', 'payment_methods',
    'plan_discounts', 'projects', 'tenant_companies', 'tickets',
    'transactions', 'usage_tracking'
  ];

  for (const table of dependentTables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) continue;

    const hasCompanyId = await knex.schema.hasColumn(table, 'company_id');
    const hasClientId = await knex.schema.hasColumn(table, 'client_id');

    if (hasCompanyId && hasClientId) {
      console.log(`  Backfilling ${table}.company_id from client_id...`);
      await knex.raw(`
        UPDATE ${table}
        SET company_id = client_id
        WHERE company_id IS NULL AND client_id IS NOT NULL
      `);
    }
  }

  console.log('✓ Backfill complete');
}
