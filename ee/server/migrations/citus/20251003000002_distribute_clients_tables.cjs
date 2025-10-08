/**
 * Distribute client-related tables (renamed from company) in Citus
 * This migration should run after 20251003001_company_to_client_migration.cjs
 * Dependencies: tenants must be distributed first
 */

exports.config = { transaction: false };

exports.up = async function(knex) {
  // Check if we're in recovery mode (read replica/standby)
  const inRecovery = await knex.raw(`SELECT pg_is_in_recovery() as in_recovery`);

  if (inRecovery.rows[0].in_recovery) {
    console.log('Database is in recovery mode (read replica). Skipping Citus distribution.');
    console.log('This migration must run on the primary/coordinator node.');
    return;
  }

  // Check if Citus is enabled
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping client tables distribution');
    return;
  }

  console.log('Distributing client tables (renamed from company)...');

  // Distribute clients table
  await distributeClientsTable(knex);

  // Distribute client_locations table
  await distributeClientLocationsTable(knex);

  // Distribute client_billing_cycles table
  await distributeClientBillingCyclesTable(knex);

  // Distribute client_billing_settings table
  await distributeClientBillingSettingsTable(knex);

  // Distribute client_tax_settings table
  await distributeClientTaxSettingsTable(knex);

  // Distribute client_tax_rates table
  await distributeClientTaxRatesTable(knex);

  // Distribute client_billing_plans table
  await distributeClientBillingPlansTable(knex);

  // Distribute client_plan_bundles table
  await distributeClientPlanBundlesTable(knex);

  console.log('\n✓ Client tables distribution completed');
};

async function distributeClientsTable(knex) {
  console.log('\n--- Distributing clients table ---');

  // Check if clients table exists
  const clientsExists = await knex.schema.hasTable('clients');
  if (!clientsExists) {
    console.log('clients table does not exist yet - base migration may not have run');
    return;
  }

  // Check if already distributed
  const clientsDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'clients'::regclass
    ) as distributed
  `);

  if (clientsDistributed.rows[0].distributed) {
    console.log('  clients table already distributed');
    return;
  }

  try {
    console.log('  Capturing foreign key constraints for clients...');

    // Capture FKs
    const capturedFKs = await knex.raw(`
      SELECT
        conname as constraint_name,
        pg_get_constraintdef(c.oid) as definition
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.conrelid = 'clients'::regclass
      AND c.contype = 'f'
    `);

    console.log('  Dropping foreign key constraints for clients...');
    for (const fk of capturedFKs.rows) {
      try {
        await knex.raw(`ALTER TABLE clients DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
        console.log(`    ✓ Dropped FK: ${fk.constraint_name}`);
      } catch (e) {
        console.log(`    - Could not drop ${fk.constraint_name}: ${e.message}`);
      }
    }

    // Drop unique constraints with CASCADE
    console.log('  Dropping unique constraints for clients...');
    const uniqueConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'clients'::regclass
      AND contype = 'u'
    `);

    for (const constraint of uniqueConstraints.rows) {
      try {
        await knex.raw(`ALTER TABLE clients DROP CONSTRAINT ${constraint.conname} CASCADE`);
        console.log(`    ✓ Dropped constraint: ${constraint.conname} with CASCADE`);
      } catch (e) {
        console.log(`    - Could not drop ${constraint.conname}: ${e.message}`);
      }
    }

    // Distribute the clients table
    console.log('  Distributing clients table...');
    await knex.raw(`SELECT create_distributed_table('clients', 'tenant')`);
    console.log('    ✓ Distributed clients table');

    // Recreate unique constraints
    console.log('  Recreating unique constraints for clients...');
    // NOTE: Cannot create UNIQUE constraint on client_id alone in distributed table
    // because it doesn't include partition column (tenant)
    // The composite unique constraint (tenant, client_id) is enforced by the primary key
    await knex.raw(`
      ALTER TABLE clients
      ADD CONSTRAINT clients_tenant_client_name_unique UNIQUE (tenant, client_name)
    `);
    console.log('    ✓ Recreated unique constraints');

    // Recreate indexes
    console.log('  Recreating indexes for clients...');
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_clients_tenant_client_name
      ON clients(tenant, client_name)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_clients_tenant_inactive_name
      ON clients(tenant, is_inactive, client_name)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_clients_tenant_client_type
      ON clients(tenant, client_type)
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_clients_tenant_url
      ON clients(tenant, url)
    `);
    console.log('    ✓ Recreated indexes');

    // Recreate foreign keys
    console.log('  Recreating foreign keys for clients...');
    for (const fk of capturedFKs.rows) {
      try {
        await knex.raw(`ALTER TABLE clients ADD CONSTRAINT ${fk.constraint_name} ${fk.definition}`);
        console.log(`    ✓ Recreated FK: ${fk.constraint_name}`);
      } catch (e) {
        console.log(`    - Could not recreate ${fk.constraint_name}: ${e.message}`);
      }
    }

    console.log('\n✓ clients table distributed successfully');

  } catch (error) {
    console.error(`  ✗ Failed to distribute clients table: ${error.message}`);
    throw error;
  }
}

async function distributeClientLocationsTable(knex) {
  console.log('\n--- Distributing client_locations table ---');

  const tableExists = await knex.schema.hasTable('client_locations');
  if (!tableExists) {
    console.log('  client_locations table does not exist, skipping');
    return;
  }

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'client_locations'::regclass
    ) as distributed
  `);

  if (isDistributed.rows[0].distributed) {
    console.log('  client_locations already distributed');
    return;
  }

  try {
    // Drop FKs
    await knex.raw(`ALTER TABLE client_locations DROP CONSTRAINT IF EXISTS client_locations_tenant_foreign`);
    await knex.raw(`ALTER TABLE client_locations DROP CONSTRAINT IF EXISTS client_locations_client_id_tenant_foreign`);
    await knex.raw(`ALTER TABLE client_locations DROP CONSTRAINT IF EXISTS client_locations_client_id_foreign`);
    await knex.raw(`ALTER TABLE client_locations DROP CONSTRAINT IF EXISTS client_locations_region_code_tenant_foreign`);

    // Distribute
    await knex.raw(`SELECT create_distributed_table('client_locations', 'tenant')`);
    console.log('  ✓ Distributed client_locations');

    // Recreate FKs with correct composite keys
    await knex.raw(`
      ALTER TABLE client_locations
      ADD CONSTRAINT client_locations_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant)
    `);

    await knex.raw(`
      ALTER TABLE client_locations
      ADD CONSTRAINT client_locations_client_id_tenant_foreign
      FOREIGN KEY (client_id, tenant) REFERENCES clients(client_id, tenant) ON DELETE CASCADE
    `);

    await knex.raw(`
      ALTER TABLE client_locations
      ADD CONSTRAINT client_locations_region_code_tenant_foreign
      FOREIGN KEY (region_code, tenant) REFERENCES tax_regions(region_code, tenant)
    `);
    console.log('  ✓ Recreated FKs for client_locations')

  } catch (error) {
    console.error(`  ✗ Failed to distribute client_locations: ${error.message}`);
    throw error;
  }
}

async function distributeClientBillingCyclesTable(knex) {
  console.log('\n--- Distributing client_billing_cycles table ---');

  const tableExists = await knex.schema.hasTable('client_billing_cycles');
  if (!tableExists) {
    console.log('  client_billing_cycles table does not exist, skipping');
    return;
  }

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'client_billing_cycles'::regclass
    ) as distributed
  `);

  if (isDistributed.rows[0].distributed) {
    console.log('  client_billing_cycles already distributed');
    return;
  }

  try {
    // Drop FKs (if they exist from non-Citus environment)
    await knex.raw(`ALTER TABLE client_billing_cycles DROP CONSTRAINT IF EXISTS client_billing_cycles_tenant_foreign`);
    await knex.raw(`ALTER TABLE client_billing_cycles DROP CONSTRAINT IF EXISTS client_billing_cycles_client_id_foreign`);

    // Distribute
    await knex.raw(`SELECT create_distributed_table('client_billing_cycles', 'tenant')`);
    console.log('  ✓ Distributed client_billing_cycles');

    // Recreate FKs with correct composite keys
    await knex.raw(`
      ALTER TABLE client_billing_cycles
      ADD CONSTRAINT client_billing_cycles_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant)
    `);

    await knex.raw(`
      ALTER TABLE client_billing_cycles
      ADD CONSTRAINT client_billing_cycles_client_id_foreign
      FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id) ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FKs for client_billing_cycles')

  } catch (error) {
    console.error(`  ✗ Failed to distribute client_billing_cycles: ${error.message}`);
    throw error;
  }
}

async function distributeClientBillingSettingsTable(knex) {
  console.log('\n--- Distributing client_billing_settings table ---');

  const tableExists = await knex.schema.hasTable('client_billing_settings');
  if (!tableExists) {
    console.log('  client_billing_settings table does not exist, skipping');
    return;
  }

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'client_billing_settings'::regclass
    ) as distributed
  `);

  if (isDistributed.rows[0].distributed) {
    console.log('  client_billing_settings already distributed');
    return;
  }

  try {
    // Drop FKs and constraints
    await knex.raw(`ALTER TABLE client_billing_settings DROP CONSTRAINT IF EXISTS client_billing_settings_tenant_foreign`);
    await knex.raw(`ALTER TABLE client_billing_settings DROP CONSTRAINT IF EXISTS client_billing_settings_tenant_client_id_foreign`);
    await knex.raw(`ALTER TABLE client_billing_settings DROP CONSTRAINT IF EXISTS client_billing_settings_client_id_foreign`);
    await knex.raw(`ALTER TABLE client_billing_settings DROP CONSTRAINT IF EXISTS client_billing_settings_zero_dollar_invoice_handling_check CASCADE`);

    // Distribute
    await knex.raw(`SELECT create_distributed_table('client_billing_settings', 'tenant')`);
    console.log('  ✓ Distributed client_billing_settings');

    // Recreate check constraint
    await knex.raw(`
      ALTER TABLE client_billing_settings
      ADD CONSTRAINT client_billing_settings_zero_dollar_invoice_handling_check
      CHECK (zero_dollar_invoice_handling = ANY (ARRAY['normal'::text, 'finalized'::text]))
    `);

    // Recreate FKs with correct composite keys
    await knex.raw(`
      ALTER TABLE client_billing_settings
      ADD CONSTRAINT client_billing_settings_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant)
    `);

    await knex.raw(`
      ALTER TABLE client_billing_settings
      ADD CONSTRAINT client_billing_settings_tenant_client_id_foreign
      FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
    `);
    console.log('  ✓ Recreated FKs for client_billing_settings')

  } catch (error) {
    console.error(`  ✗ Failed to distribute client_billing_settings: ${error.message}`);
    throw error;
  }
}

async function distributeClientTaxSettingsTable(knex) {
  console.log('\n--- Distributing client_tax_settings table ---');

  const tableExists = await knex.schema.hasTable('client_tax_settings');
  if (!tableExists) {
    console.log('  client_tax_settings table does not exist, skipping');
    return;
  }

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'client_tax_settings'::regclass
    ) as distributed
  `);

  if (isDistributed.rows[0].distributed) {
    console.log('  client_tax_settings already distributed');
    return;
  }

  try {
    // Drop FKs
    await knex.raw(`ALTER TABLE client_tax_settings DROP CONSTRAINT IF EXISTS client_tax_settings_tenant_foreign`);
    await knex.raw(`ALTER TABLE client_tax_settings DROP CONSTRAINT IF EXISTS client_tax_settings_client_id_foreign`);

    // Distribute
    await knex.raw(`SELECT create_distributed_table('client_tax_settings', 'tenant')`);
    console.log('  ✓ Distributed client_tax_settings');

    // Recreate FKs with correct composite keys
    await knex.raw(`
      ALTER TABLE client_tax_settings
      ADD CONSTRAINT client_tax_settings_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant)
    `);

    await knex.raw(`
      ALTER TABLE client_tax_settings
      ADD CONSTRAINT client_tax_settings_client_id_foreign
      FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
    `);
    console.log('  ✓ Recreated FKs for client_tax_settings')

  } catch (error) {
    console.error(`  ✗ Failed to distribute client_tax_settings: ${error.message}`);
    throw error;
  }
}

async function distributeClientTaxRatesTable(knex) {
  console.log('\n--- Distributing client_tax_rates table ---');

  const tableExists = await knex.schema.hasTable('client_tax_rates');
  if (!tableExists) {
    console.log('  client_tax_rates table does not exist, skipping');
    return;
  }

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'client_tax_rates'::regclass
    ) as distributed
  `);

  if (isDistributed.rows[0].distributed) {
    console.log('  client_tax_rates already distributed');
    return;
  }

  try {
    // Drop FKs
    await knex.raw(`ALTER TABLE client_tax_rates DROP CONSTRAINT IF EXISTS client_tax_rates_tenant_foreign`);
    await knex.raw(`ALTER TABLE client_tax_rates DROP CONSTRAINT IF EXISTS client_tax_rates_client_id_foreign`);
    await knex.raw(`ALTER TABLE client_tax_rates DROP CONSTRAINT IF EXISTS client_tax_rates_tax_rate_id_foreign`);

    // Drop unique constraints
    const uniqueConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'client_tax_rates'::regclass AND contype = 'u'
    `);

    for (const constraint of uniqueConstraints.rows) {
      await knex.raw(`ALTER TABLE client_tax_rates DROP CONSTRAINT ${constraint.conname} CASCADE`);
    }

    // Distribute
    await knex.raw(`SELECT create_distributed_table('client_tax_rates', 'tenant')`);
    console.log('  ✓ Distributed client_tax_rates');

    // Recreate FKs with correct composite keys
    await knex.raw(`
      ALTER TABLE client_tax_rates
      ADD CONSTRAINT client_tax_rates_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant)
    `);

    await knex.raw(`
      ALTER TABLE client_tax_rates
      ADD CONSTRAINT client_tax_rates_client_id_foreign
      FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
    `);
    console.log('  ✓ Recreated FKs for client_tax_rates')

  } catch (error) {
    console.error(`  ✗ Failed to distribute client_tax_rates: ${error.message}`);
    throw error;
  }
}

async function distributeClientBillingPlansTable(knex) {
  console.log('\n--- Distributing client_billing_plans table ---');

  const tableExists = await knex.schema.hasTable('client_billing_plans');
  if (!tableExists) {
    console.log('  client_billing_plans table does not exist, skipping');
    return;
  }

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'client_billing_plans'::regclass
    ) as distributed
  `);

  if (isDistributed.rows[0].distributed) {
    console.log('  client_billing_plans already distributed');
    return;
  }

  try {
    // Drop FKs
    await knex.raw(`ALTER TABLE client_billing_plans DROP CONSTRAINT IF EXISTS client_billing_plans_tenant_foreign`);
    await knex.raw(`ALTER TABLE client_billing_plans DROP CONSTRAINT IF EXISTS client_billing_plans_tenant_client_id_foreign`);
    await knex.raw(`ALTER TABLE client_billing_plans DROP CONSTRAINT IF EXISTS client_billing_plans_tenant_plan_id_foreign`);

    // Distribute
    await knex.raw(`SELECT create_distributed_table('client_billing_plans', 'tenant')`);
    console.log('  ✓ Distributed client_billing_plans');

    // Recreate FKs with correct composite keys
    await knex.raw(`
      ALTER TABLE client_billing_plans
      ADD CONSTRAINT client_billing_plans_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant)
    `);

    await knex.raw(`
      ALTER TABLE client_billing_plans
      ADD CONSTRAINT client_billing_plans_tenant_client_id_foreign
      FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id)
    `);
    console.log('  ✓ Recreated FKs for client_billing_plans')

  } catch (error) {
    console.error(`  ✗ Failed to distribute client_billing_plans: ${error.message}`);
    throw error;
  }
}

async function distributeClientPlanBundlesTable(knex) {
  console.log('\n--- Distributing client_plan_bundles table ---');

  const tableExists = await knex.schema.hasTable('client_plan_bundles');
  if (!tableExists) {
    console.log('  client_plan_bundles table does not exist, skipping');
    return;
  }

  const isDistributed = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = 'client_plan_bundles'::regclass
    ) as distributed
  `);

  if (isDistributed.rows[0].distributed) {
    console.log('  client_plan_bundles already distributed');
    return;
  }

  try {
    // Drop FKs
    await knex.raw(`ALTER TABLE client_plan_bundles DROP CONSTRAINT IF EXISTS client_plan_bundles_tenant_foreign`);
    await knex.raw(`ALTER TABLE client_plan_bundles DROP CONSTRAINT IF EXISTS client_plan_bundles_tenant_client_id_foreign`);
    await knex.raw(`ALTER TABLE client_plan_bundles DROP CONSTRAINT IF EXISTS client_plan_bundles_tenant_bundle_id_foreign`);

    // Drop unique constraints
    const uniqueConstraints = await knex.raw(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'client_plan_bundles'::regclass AND contype = 'u'
    `);

    for (const constraint of uniqueConstraints.rows) {
      await knex.raw(`ALTER TABLE client_plan_bundles DROP CONSTRAINT ${constraint.conname} CASCADE`);
    }

    // Distribute
    await knex.raw(`SELECT create_distributed_table('client_plan_bundles', 'tenant')`);
    console.log('  ✓ Distributed client_plan_bundles');

    // Recreate unique constraint
    await knex.raw(`
      ALTER TABLE client_plan_bundles
      ADD CONSTRAINT client_plan_bundles_tenant_client_bundle_id_unique
      UNIQUE (tenant, client_bundle_id)
    `);

    // Recreate FKs with correct composite keys
    await knex.raw(`
      ALTER TABLE client_plan_bundles
      ADD CONSTRAINT client_plan_bundles_tenant_foreign
      FOREIGN KEY (tenant) REFERENCES tenants(tenant)
    `);

    await knex.raw(`
      ALTER TABLE client_plan_bundles
      ADD CONSTRAINT client_plan_bundles_tenant_client_id_foreign
      FOREIGN KEY (tenant, client_id) REFERENCES clients(tenant, client_id) ON DELETE CASCADE
    `);
    console.log('  ✓ Recreated FKs for client_plan_bundles')

  } catch (error) {
    console.error(`  ✗ Failed to distribute client_plan_bundles: ${error.message}`);
    throw error;
  }
}

exports.down = async function(knex) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) as enabled
  `);

  if (!citusEnabled.rows[0].enabled) {
    return;
  }

  console.log('Undistributing client tables...');

  const tables = [
    'client_plan_bundles',
    'client_billing_plans',
    'client_tax_rates',
    'client_tax_settings',
    'client_billing_settings',
    'client_billing_cycles',
    'client_locations',
    'clients'
  ];

  for (const table of tables) {
    try {
      const isDistributed = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition
          WHERE logicalrelid = '${table}'::regclass
        ) as distributed
      `);

      if (isDistributed.rows[0].distributed) {
        await knex.raw(`SELECT undistribute_table('${table}')`);
        console.log(`  ✓ Undistributed ${table}`);
      }
    } catch (error) {
      console.error(`  ✗ Failed to undistribute ${table}: ${error.message}`);
    }
  }

  console.log('✓ Client tables undistribution completed');
};
