/**
 * Migration 2 Combined Rename: Plan Bundle/Billing Plan Terminology Flip
 *
 * This migration creates the new tables, adds dual-write columns, and
 * backfills data so that the application can run with both legacy and new
 * identifiers during the stabilisation window.
 *
 *
 * @param { import("knex").Knex } knex
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  console.log('='.repeat(80));
  console.log('Starting combined contracts + contract lines rename migration...');
  console.log('='.repeat(80));

  const state = {
    createdTables: [],
    addedColumns: [],
  };

  try {
    await migrateContracts(knex, state);
    await migrateContractLines(knex, state);
    await verifyContracts(knex);
    await verifyContractLines(knex);

    console.log('='.repeat(80));
    console.log('✓ Combined rename migration completed successfully');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('❌ Combined rename migration failed:', error.message);
    await rollbackChanges(knex, state);
    throw error;
  }
};

exports.down = async function down(knex) {
  console.log('Rolling back combined contracts + contract lines rename migration...');

  // Drop contract_line_id columns from dependent tables
  const contractLineTables = [
    'bucket_usage',
    'plan_discounts',
    'plan_service_configuration',
    'plan_services',
    'time_entries',
    'usage_tracking',
    'contract_line_mappings',
  ];

  for (const table of contractLineTables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, 'contract_line_id');
    if (hasColumn) {
      await knex.schema.table(table, (t) => {
        t.dropColumn('contract_line_id');
      });
    }
  }

  // Drop client_contract_id column from company_billing_plans
  const hasClientContractId = await knex.schema.hasColumn('company_billing_plans', 'client_contract_id');
  if (hasClientContractId) {
    await knex.schema.table('company_billing_plans', (table) => {
      table.dropColumn('client_contract_id');
    });
  }

  // Drop created tables (reverse order)
  const tables = [
    'client_contract_lines',
    'contract_line_fixed_config',
    'contract_lines',
    'contract_line_mappings',
    'client_contracts',
    'contracts',
  ];

  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }

  console.log('✓ Rollback completed');
};

async function migrateContracts(knex, state) {
  console.log('--- Contracts workstream (plan_bundles → contracts) ---');

  await createContractsTable(knex, state);
  await backfillContracts(knex);
  await createClientContracts(knex, state);
  await createContractLineMappings(knex, state);
  await addContractIdColumns(knex, state);
  await backfillContractIds(knex);
}

async function migrateContractLines(knex, state) {
  console.log('--- Contract lines workstream (billing_plans → contract_lines) ---');

  await createContractLinesTable(knex, state);
  await backfillContractLines(knex);
  await createContractLineFixedConfig(knex, state);
  await createClientContractLines(knex, state);
  await addContractLineIdColumns(knex, state);
  await backfillContractLineIds(knex);
  await updateContractLineMappings(knex, state);
}

async function rollbackChanges(knex, state) {
  console.log('Rolling back partial changes from combined migration...');

  for (const { table, column } of state.addedColumns.reverse()) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, column);
    if (!hasColumn) {
      continue;
    }

    console.log(`  Dropping column ${table}.${column}`);
    await knex.schema.table(table, (t) => {
      t.dropColumn(column);
    });
  }

  for (const table of state.createdTables.reverse()) {
    console.log(`  Dropping table ${table}`);
    await knex.schema.dropTableIfExists(table);
  }

  console.log('✓ Partial rollback completed');
}

async function createContractsTable(knex, state) {
  const exists = await knex.schema.hasTable('contracts');
  if (exists) {
    console.log('contracts table already exists, skipping creation');
    return;
  }

  console.log('Creating contracts table...');
  state.createdTables.push('contracts');

  await knex.schema.createTable('contracts', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('contract_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.string('bundle_name', 255).notNullable();
    table.text('bundle_description');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.primary(['tenant', 'contract_id']);
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts(tenant)');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS contracts_tenant_contract_id_unique ON contracts(tenant, contract_id)');

  await addTenantForeignKey(knex, 'contracts', 'contracts_tenant_fkey');
}

async function backfillContracts(knex) {
  console.log('Backfilling contracts from plan_bundles...');

  await knex.raw(`
    INSERT INTO contracts (
      tenant, contract_id, bundle_name, bundle_description,
      is_active, created_at, updated_at
    )
    SELECT
      pb.tenant, pb.bundle_id, pb.bundle_name, pb.bundle_description,
      pb.is_active, pb.created_at, pb.updated_at
    FROM plan_bundles pb
    ON CONFLICT (tenant, contract_id) DO NOTHING
  `);

  const [{ count }] = await knex('contracts').count('* as count');
  console.log(`  ✓ Backfilled ${count} contracts`);
}

async function createClientContracts(knex, state) {
  const exists = await knex.schema.hasTable('client_contracts');
  if (exists) {
    console.log('client_contracts table already exists, skipping creation');
    return;
  }

  console.log('Creating client_contracts table...');
  state.createdTables.push('client_contracts');

  await knex.schema.createTable('client_contracts', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_contract_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('client_id').notNullable();
    table.uuid('contract_id').notNullable();
    table.timestamp('start_date').notNullable();
    table.timestamp('end_date');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.primary(['tenant', 'client_contract_id']);
    table.unique(['tenant', 'client_contract_id']);
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS client_contracts_contract_id_index ON client_contracts(contract_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS client_contracts_client_id_index ON client_contracts(client_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS client_contracts_tenant_index ON client_contracts(tenant)');

  await addTenantForeignKey(knex, 'client_contracts', 'client_contracts_tenant_fkey');

  console.log('Backfilling client_contracts from client_plan_bundles...');

  await knex.raw(`
    INSERT INTO client_contracts (
      tenant, client_contract_id, client_id, contract_id,
      start_date, end_date, is_active, created_at, updated_at
    )
    SELECT
      cpb.tenant, gen_random_uuid(), cpb.client_id, cpb.bundle_id,
      cpb.start_date, cpb.end_date, cpb.is_active, cpb.created_at, cpb.updated_at
    FROM client_plan_bundles cpb
    ON CONFLICT (tenant, client_contract_id) DO NOTHING
  `);

  const [{ count }] = await knex('client_contracts').count('* as count');
  console.log(`  ✓ Backfilled ${count} client_contracts`);
}

async function createContractLineMappings(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_mappings');
  if (exists) {
    console.log('contract_line_mappings table already exists, skipping creation');
    return;
  }

  console.log('Creating contract_line_mappings table...');
  state.createdTables.push('contract_line_mappings');

  await knex.schema.createTable('contract_line_mappings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('contract_id').notNullable();
    table.uuid('plan_id').notNullable();
    table.integer('display_order').defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.decimal('custom_rate', 10, 2);

    table.primary(['tenant', 'contract_id', 'plan_id']);
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS contract_line_mappings_tenant_index ON contract_line_mappings(tenant)');
  await knex.raw('CREATE INDEX IF NOT EXISTS contract_line_mappings_contract_id_index ON contract_line_mappings(contract_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS contract_line_mappings_plan_id_index ON contract_line_mappings(plan_id)');

  await addTenantForeignKey(knex, 'contract_line_mappings', 'contract_line_mappings_tenant_fkey');

  console.log('Backfilling contract_line_mappings from bundle_billing_plans...');

  await knex.raw(`
    INSERT INTO contract_line_mappings (
      tenant, contract_id, plan_id, display_order, created_at, custom_rate
    )
    SELECT
      bbp.tenant, bbp.bundle_id, bbp.plan_id, bbp.display_order, bbp.created_at, bbp.custom_rate
    FROM bundle_billing_plans bbp
    ON CONFLICT (tenant, contract_id, plan_id) DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_mappings').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_mappings`);
}

async function addContractIdColumns(knex, state) {
  const hasColumn = await knex.schema.hasColumn('client_billing_plans', 'client_contract_id');
  if (hasColumn) {
    console.log('client_billing_plans.client_contract_id already exists, skipping');
    return;
  }

  console.log('Adding client_contract_id column to client_billing_plans...');

  await knex.schema.table('client_billing_plans', (table) => {
    table.uuid('client_contract_id');
  });

  state.addedColumns.push({ table: 'client_billing_plans', column: 'client_contract_id' });
}

async function backfillContractIds(knex) {
  console.log('Backfilling client_billing_plans.client_contract_id from client_contracts...');

  await knex.raw(`
    UPDATE client_billing_plans cbp
    SET client_contract_id = cc.client_contract_id
    FROM client_contracts cc
    JOIN contract_line_mappings clm ON clm.tenant = cc.tenant AND clm.contract_id = cc.contract_id
    WHERE cbp.tenant = cc.tenant
      AND cbp.client_id = cc.client_id
      AND cbp.plan_id = clm.plan_id
      AND cbp.client_contract_id IS NULL
  `);

  const [{ count }] = await knex('client_billing_plans')
    .whereNotNull('client_contract_id')
    .count('* as count');

  console.log(`  ✓ Backfilled ${count} rows in client_billing_plans`);
}

async function createContractLinesTable(knex, state) {
  const exists = await knex.schema.hasTable('contract_lines');
  if (exists) {
    console.log('contract_lines table already exists, skipping creation');
    return;
  }

  console.log('Creating contract_lines table...');
  state.createdTables.push('contract_lines');

  await knex.schema.createTable('contract_lines', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('contract_line_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('plan_name').notNullable();
    table.text('description');
    table.text('billing_frequency').notNullable();
    table.boolean('is_custom').defaultTo(false);
    table.text('plan_type');
    table.boolean('is_active').defaultTo(true);
    table.boolean('enable_overtime').defaultTo(false);
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold').defaultTo(40);
    table.boolean('enable_after_hours_rate').defaultTo(false);
    table.decimal('after_hours_multiplier', 10, 2).defaultTo(1);

    table.primary(['tenant', 'contract_line_id']);
  });

  await addTenantForeignKey(knex, 'contract_lines', 'contract_lines_tenant_fkey');
}

async function backfillContractLines(knex) {
  console.log('Backfilling contract_lines from billing_plans...');

  await knex.raw(`
    INSERT INTO contract_lines (
      tenant, contract_line_id, plan_name, description, billing_frequency,
      is_custom, plan_type, is_active, enable_overtime, overtime_rate,
      overtime_threshold, enable_after_hours_rate, after_hours_multiplier
    )
    SELECT
      bp.tenant, bp.plan_id, bp.plan_name, bp.description, bp.billing_frequency,
      bp.is_custom, bp.plan_type, bp.is_active, bp.enable_overtime, bp.overtime_rate,
      bp.overtime_threshold, bp.enable_after_hours_rate, bp.after_hours_multiplier
    FROM billing_plans bp
    ON CONFLICT (tenant, contract_line_id) DO NOTHING
  `);

  const [{ count }] = await knex('contract_lines').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_lines`);
}

async function createContractLineFixedConfig(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_fixed_config');
  if (exists) {
    console.log('contract_line_fixed_config table already exists, skipping creation');
    return;
  }

  console.log('Creating contract_line_fixed_config table...');
  state.createdTables.push('contract_line_fixed_config');

  await knex.schema.createTable('contract_line_fixed_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('contract_line_id').notNullable();
    table.decimal('base_rate', 10, 2);
    table.boolean('enable_proration').notNullable().defaultTo(false);
    table.string('billing_cycle_alignment').notNullable().defaultTo('start');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'contract_line_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_fixed_config', 'contract_line_fixed_config_tenant_fkey');

  const billingPlanFixedConfigExists = await knex.schema.hasTable('billing_plan_fixed_config');
  if (!billingPlanFixedConfigExists) {
    console.log('⚠ billing_plan_fixed_config table not found, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_fixed_config from billing_plan_fixed_config...');

  await knex.raw(`
    INSERT INTO contract_line_fixed_config (
      tenant, contract_line_id, base_rate, enable_proration,
      billing_cycle_alignment, created_at, updated_at
    )
    SELECT
      bpfc.tenant, bpfc.plan_id, bpfc.base_rate, bpfc.enable_proration,
      bpfc.billing_cycle_alignment, bpfc.created_at, bpfc.updated_at
    FROM billing_plan_fixed_config bpfc
    ON CONFLICT (tenant, contract_line_id) DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_fixed_config').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_fixed_config rows`);
}

async function createClientContractLines(knex, state) {
  const exists = await knex.schema.hasTable('client_contract_lines');
  if (exists) {
    console.log('client_contract_lines table already exists, skipping creation');
    return;
  }

  console.log('Creating client_contract_lines table...');
  state.createdTables.push('client_contract_lines');

  await knex.schema.createTable('client_contract_lines', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_contract_line_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('client_id').notNullable();
    table.uuid('contract_line_id').notNullable();
    table.uuid('service_category');
    table.boolean('is_active').defaultTo(true);
    table.timestamp('start_date').notNullable();
    table.timestamp('end_date');
    table.uuid('client_contract_id');

    table.primary(['tenant', 'client_contract_line_id']);
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS client_contract_lines_client_contract_id_index ON client_contract_lines(client_contract_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS client_contract_lines_client_id_index ON client_contract_lines(client_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS client_contract_lines_contract_line_id_index ON client_contract_lines(contract_line_id)');

  await addTenantForeignKey(knex, 'client_contract_lines', 'client_contract_lines_tenant_fkey');

  console.log('Backfilling client_contract_lines from company_billing_plans...');

  await knex.raw(`
    INSERT INTO client_contract_lines (
      tenant, client_contract_line_id, client_id, contract_line_id,
      service_category, is_active, start_date, end_date, client_contract_id
    )
    SELECT
      cbp.tenant, cbp.company_billing_plan_id, cbp.client_id, cbp.plan_id,
      cbp.service_category, cbp.is_active, cbp.start_date, cbp.end_date, cbp.client_contract_id
    FROM company_billing_plans cbp
    ON CONFLICT (tenant, client_contract_line_id) DO NOTHING
  `);

  const [{ count }] = await knex('client_contract_lines').count('* as count');
  console.log(`  ✓ Backfilled ${count} client_contract_lines`);
}

async function addContractLineIdColumns(knex, state) {
  console.log('Adding contract_line_id columns to dependent tables...');

  const tables = [
    { table: 'bucket_usage', oldColumn: 'plan_id' },
    { table: 'plan_discounts', oldColumn: 'plan_id' },
    { table: 'plan_service_configuration', oldColumn: 'plan_id' },
    { table: 'plan_services', oldColumn: 'plan_id' },
    { table: 'time_entries', oldColumn: 'billing_plan_id' },
    { table: 'usage_tracking', oldColumn: 'billing_plan_id' },
  ];

  for (const { table, oldColumn } of tables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      console.log(`  ⚠ Table ${table} does not exist, skipping`);
      continue;
    }

    const hasOldColumn = await knex.schema.hasColumn(table, oldColumn);
    if (!hasOldColumn) {
      console.log(`  ⚠ Column ${oldColumn} not found in ${table}, skipping`);
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, 'contract_line_id');
    if (hasColumn) {
      console.log(`  ✓ ${table}.contract_line_id already exists`);
      continue;
    }

    console.log(`  Adding contract_line_id to ${table}...`);
    await knex.schema.table(table, (t) => {
      t.uuid('contract_line_id');
    });
    state.addedColumns.push({ table, column: 'contract_line_id' });
  }
}

async function backfillContractLineIds(knex) {
  console.log('Backfilling contract_line_id columns from legacy identifiers...');

  const planIdTables = [
    'bucket_usage',
    'plan_discounts',
    'plan_service_configuration',
    'plan_services',
  ];

  for (const table of planIdTables) {
    const tableExists = await knex.schema.hasTable(table);
    const hasColumn = tableExists ? await knex.schema.hasColumn(table, 'contract_line_id') : false;
    if (!tableExists || !hasColumn) {
      continue;
    }

    console.log(`  Backfilling ${table}.contract_line_id from plan_id...`);
    const result = await knex.raw(`
      UPDATE ${table}
      SET contract_line_id = plan_id
      WHERE contract_line_id IS NULL AND plan_id IS NOT NULL
    `);
    console.log(`    ✓ Updated ${result.rowCount || 0} rows in ${table}`);
  }

  const billingPlanTables = ['time_entries', 'usage_tracking'];

  for (const table of billingPlanTables) {
    const tableExists = await knex.schema.hasTable(table);
    const hasColumn = tableExists ? await knex.schema.hasColumn(table, 'contract_line_id') : false;
    if (!tableExists || !hasColumn) {
      continue;
    }

    console.log(`  Backfilling ${table}.contract_line_id from billing_plan_id...`);
    const result = await knex.raw(`
      UPDATE ${table}
      SET contract_line_id = billing_plan_id
      WHERE contract_line_id IS NULL AND billing_plan_id IS NOT NULL
    `);
    console.log(`    ✓ Updated ${result.rowCount || 0} rows in ${table}`);
  }
}

async function updateContractLineMappings(knex, state) {
  const tableExists = await knex.schema.hasTable('contract_line_mappings');
  if (!tableExists) {
    console.log('contract_line_mappings table not found, skipping contract_line_id column');
    return;
  }

  const hasColumn = await knex.schema.hasColumn('contract_line_mappings', 'contract_line_id');
  if (hasColumn) {
    console.log('contract_line_mappings.contract_line_id already exists, skipping');
    return;
  }

  console.log('Adding contract_line_id to contract_line_mappings...');

  await knex.schema.table('contract_line_mappings', (table) => {
    table.uuid('contract_line_id');
  });

  state.addedColumns.push({ table: 'contract_line_mappings', column: 'contract_line_id' });

  const result = await knex.raw(`
    UPDATE contract_line_mappings
    SET contract_line_id = plan_id
    WHERE contract_line_id IS NULL AND plan_id IS NOT NULL
  `);

  console.log(`  ✓ Backfilled ${result.rowCount || 0} contract_line_mappings rows`);
}

async function verifyContracts(knex) {
  console.log('Verifying contracts data parity...');

  const [{ count: planBundles }] = await knex('plan_bundles').count('* as count');
  const [{ count: contracts }] = await knex('contracts').count('* as count');
  if (planBundles !== contracts) {
    throw new Error(`Row count mismatch: plan_bundles=${planBundles}, contracts=${contracts}`);
  }

  const [{ count: companyPlanBundles }] = await knex('company_plan_bundles').count('* as count');
  const [{ count: clientContracts }] = await knex('client_contracts').count('* as count');
  if (companyPlanBundles !== clientContracts) {
    throw new Error(`Row count mismatch: company_plan_bundles=${companyPlanBundles}, client_contracts=${clientContracts}`);
  }

  const [{ count: bundleBillingPlans }] = await knex('bundle_billing_plans').count('* as count');
  const [{ count: contractLineMappings }] = await knex('contract_line_mappings').count('* as count');
  if (bundleBillingPlans !== contractLineMappings) {
    throw new Error(`Row count mismatch: bundle_billing_plans=${bundleBillingPlans}, contract_line_mappings=${contractLineMappings}`);
  }

  console.log(`  ✓ Verified contracts: ${contracts} rows, client_contracts=${clientContracts}, contract_line_mappings=${contractLineMappings}`);
}

async function verifyContractLines(knex) {
  console.log('Verifying contract line data parity...');

  const [{ count: billingPlans }] = await knex('billing_plans').count('* as count');
  const [{ count: contractLines }] = await knex('contract_lines').count('* as count');
  if (billingPlans !== contractLines) {
    throw new Error(`Row count mismatch: billing_plans=${billingPlans}, contract_lines=${contractLines}`);
  }

  const [{ count: companyBillingPlans }] = await knex('company_billing_plans').count('* as count');
  const [{ count: clientContractLines }] = await knex('client_contract_lines').count('* as count');
  if (companyBillingPlans !== clientContractLines) {
    throw new Error(`Row count mismatch: company_billing_plans=${companyBillingPlans}, client_contract_lines=${clientContractLines}`);
  }

  const timeEntriesExists = await knex.schema.hasTable('time_entries');
  if (timeEntriesExists) {
    const result = await knex.raw(`
      SELECT
        COUNT(*) FILTER (WHERE billing_plan_id IS NOT NULL) AS legacy_rows,
        COUNT(*) FILTER (WHERE contract_line_id IS NOT NULL) AS contract_line_rows
      FROM time_entries
    `);

    const stats = result.rows[0];
    if (stats.legacy_rows !== stats.contract_line_rows) {
      throw new Error(`CRITICAL: time_entries backfill incomplete! billing_plan_id=${stats.legacy_rows}, contract_line_id=${stats.contract_line_rows}`);
    }
  }

  const usageTrackingExists = await knex.schema.hasTable('usage_tracking');
  if (usageTrackingExists) {
    const result = await knex.raw(`
      SELECT
        COUNT(*) FILTER (WHERE billing_plan_id IS NOT NULL) AS legacy_rows,
        COUNT(*) FILTER (WHERE contract_line_id IS NOT NULL) AS contract_line_rows
      FROM usage_tracking
    `);

    const stats = result.rows[0];
    if (stats.legacy_rows !== stats.contract_line_rows) {
      throw new Error(`usage_tracking backfill incomplete! billing_plan_id=${stats.legacy_rows}, contract_line_id=${stats.contract_line_rows}`);
    }
  }

  const planServiceConfigExists = await knex.schema.hasTable('plan_service_configuration');
  if (planServiceConfigExists) {
    const result = await knex.raw(`
      SELECT
        COUNT(*) FILTER (WHERE plan_id IS NOT NULL) AS legacy_rows,
        COUNT(*) FILTER (WHERE contract_line_id IS NOT NULL) AS contract_line_rows
      FROM plan_service_configuration
    `);

    const stats = result.rows[0];
    if (stats.legacy_rows !== stats.contract_line_rows) {
      throw new Error(`plan_service_configuration backfill incomplete! plan_id=${stats.legacy_rows}, contract_line_id=${stats.contract_line_rows}`);
    }
  }

  console.log('  ✓ Verified contract line backfills');
}

async function addTenantForeignKey(knex, tableName, constraintName) {
  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);

  if (citusEnabled.rows[0].enabled) {
    console.log(`⊘ Skipping ${constraintName} on ${tableName} (Citus – will be applied post-distribution)`);
    return;
  }

  try {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${constraintName}
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) NOT VALID
    `);
    console.log(`  ✓ Added tenant FK ${constraintName} on ${tableName}`);
  } catch (error) {
    console.log(`  ⚠ Could not add tenant FK on ${tableName}: ${error.message}`);
  }
}
