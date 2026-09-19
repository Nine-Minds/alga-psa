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
    await migrateServiceTables(knex, state);
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

  // Drop client_contract_id column from client_billing_plans
  const hasClientContractId = await knex.schema.hasColumn('client_billing_plans', 'client_contract_id');
  if (hasClientContractId) {
    await knex.schema.table('client_billing_plans', (table) => {
      table.dropColumn('client_contract_id');
    });
  }

  // Drop created tables (reverse order with CASCADE for dependencies)
  const tables = [
    'contract_line_service_usage_config',
    'contract_line_service_rate_tiers',
    'contract_line_service_hourly_configs',
    'contract_line_service_hourly_config',
    'contract_line_service_fixed_config',
    'contract_line_service_bucket_config',
    'contract_line_discounts',
    'contract_line_service_configuration',
    'contract_line_services',
    'client_contract_lines',
    'contract_line_fixed_config',
    'contract_line_mappings',
    'contract_lines',
    'client_contracts',
    'contracts',
  ];

  for (const table of tables) {
    const exists = await knex.schema.hasTable(table);
    if (exists) {
      await knex.raw(`DROP TABLE IF EXISTS ${table} CASCADE`);
      console.log(`  Dropped ${table}`);
    }
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
    table.string('contract_name', 255).notNullable();
    table.text('contract_description');
    table.text('billing_frequency').notNullable().defaultTo('monthly');
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

  const planBundlesExists = await knex.schema.hasTable('plan_bundles');
  if (!planBundlesExists) {
    console.log('  ⚠ plan_bundles table not found, skipping backfill');
    return;
  }

  await knex.raw(`
      INSERT INTO contracts (
        tenant,
        contract_id,
        contract_name,
        contract_description,
        billing_frequency,
        is_active,
        created_at,
        updated_at
      )
      SELECT
        pb.tenant,
        pb.bundle_id,
        pb.bundle_name,
        pb.bundle_description,
        COALESCE(
          (
            SELECT bp.billing_frequency
            FROM bundle_billing_plans bbp
            JOIN billing_plans bp
              ON bp.tenant = bbp.tenant
             AND bp.plan_id = bbp.plan_id
            WHERE bbp.tenant = pb.tenant
              AND bbp.bundle_id = pb.bundle_id
            ORDER BY bbp.display_order, bbp.created_at
            LIMIT 1
          ),
          'monthly'
        ) AS billing_frequency,
        pb.is_active,
        pb.created_at,
        pb.updated_at
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

  const clientPlanBundlesExists = await knex.schema.hasTable('client_plan_bundles');
  if (!clientPlanBundlesExists) {
    console.log('  ⚠ client_plan_bundles table not found, skipping backfill');
    return;
  }

  await knex.raw(`
    INSERT INTO client_contracts (
      tenant, client_contract_id, client_id, contract_id,
      start_date, end_date, is_active, created_at, updated_at
    )
    SELECT
      cpb.tenant, cpb.client_bundle_id, cpb.client_id, cpb.bundle_id,
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
    table.uuid('contract_line_id').notNullable();
    table.integer('display_order').defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.decimal('custom_rate', 10, 2);

    table.primary(['tenant', 'contract_id', 'contract_line_id']);
  });

  await knex.raw('CREATE INDEX IF NOT EXISTS contract_line_mappings_tenant_index ON contract_line_mappings(tenant)');
  await knex.raw('CREATE INDEX IF NOT EXISTS contract_line_mappings_contract_id_index ON contract_line_mappings(contract_id)');
  await knex.raw('CREATE INDEX IF NOT EXISTS contract_line_mappings_contract_line_id_index ON contract_line_mappings(contract_line_id)');

  await addTenantForeignKey(knex, 'contract_line_mappings', 'contract_line_mappings_tenant_fkey');

  console.log('Backfilling contract_line_mappings from bundle_billing_plans...');

  const bundleBillingPlansExists = await knex.schema.hasTable('bundle_billing_plans');
  if (!bundleBillingPlansExists) {
    console.log('  ⚠ bundle_billing_plans table not found, skipping backfill');
    return;
  }

  await knex.raw(`
    INSERT INTO contract_line_mappings (
      tenant,
      contract_id,
      contract_line_id,
      display_order,
      created_at,
      custom_rate
    )
    SELECT
      bbp.tenant,
      bbp.bundle_id,
      bbp.plan_id,
      bbp.display_order,
      bbp.created_at,
      bbp.custom_rate
    FROM bundle_billing_plans bbp
    ON CONFLICT (tenant, contract_id, contract_line_id) DO NOTHING
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
  console.log('Backfilling client_billing_plans.client_contract_id from client_bundle_id...');

  const tableExists = await knex.schema.hasTable('client_billing_plans');
  if (!tableExists) {
    console.log('  ⚠ client_billing_plans table not found, skipping backfill');
    return;
  }

  await knex.raw(`
    UPDATE client_billing_plans
    SET client_contract_id = client_bundle_id
    WHERE client_contract_id IS NULL AND client_bundle_id IS NOT NULL
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
    table.text('contract_line_name').notNullable();
    table.text('description');
    table.text('billing_frequency').notNullable().defaultTo('monthly');
    table.boolean('is_custom').defaultTo(false);
    table.text('contract_line_type');
    table.uuid('service_category');
    table.boolean('is_active').defaultTo(true);
    table.boolean('enable_overtime').defaultTo(false);
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold').defaultTo(40);
    table.boolean('enable_after_hours_rate').defaultTo(false);
    table.decimal('after_hours_multiplier', 10, 2).defaultTo(1);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());

    table.primary(['tenant', 'contract_line_id']);
  });

  await addTenantForeignKey(knex, 'contract_lines', 'contract_lines_tenant_fkey');
}

async function backfillContractLines(knex) {
  console.log('Backfilling contract_lines from billing_plans...');

  const billingPlansExists = await knex.schema.hasTable('billing_plans');
  if (!billingPlansExists) {
    console.log('  ⚠ billing_plans table not found, skipping backfill');
    return;
  }

  await knex.raw(`
    INSERT INTO contract_lines (
      tenant,
      contract_line_id,
      contract_line_name,
      description,
      billing_frequency,
      is_custom,
      contract_line_type,
      service_category,
      is_active,
      enable_overtime,
      overtime_rate,
      overtime_threshold,
      enable_after_hours_rate,
      after_hours_multiplier
    )
    SELECT
      bp.tenant,
      bp.plan_id,
      bp.plan_name,
      bp.description,
      bp.billing_frequency,
      bp.is_custom,
      bp.plan_type,
      NULL,
      COALESCE(bp.is_active, true),
      bp.enable_overtime,
      bp.overtime_rate,
      bp.overtime_threshold,
      bp.enable_after_hours_rate,
      bp.after_hours_multiplier
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

  console.log('Backfilling client_contract_lines from client_billing_plans...');

  const clientBillingPlansExists = await knex.schema.hasTable('client_billing_plans');
  if (!clientBillingPlansExists) {
    console.log('  ⚠ client_billing_plans table not found, skipping backfill');
    return;
  }

  await knex.raw(`
    INSERT INTO client_contract_lines (
      tenant, client_contract_line_id, client_id, contract_line_id,
      service_category, is_active, start_date, end_date, client_contract_id
    )
    SELECT
      cbp.tenant, cbp.client_billing_plan_id, cbp.client_id, cbp.plan_id,
      cbp.service_category, cbp.is_active, cbp.start_date, cbp.end_date, cbp.client_contract_id
    FROM client_billing_plans cbp
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

async function verifyContracts(knex) {
  console.log('Verifying contracts data parity...');

  const planBundlesExists = await knex.schema.hasTable('plan_bundles');
  const clientPlanBundlesExists = await knex.schema.hasTable('client_plan_bundles');
  const bundleBillingPlansExists = await knex.schema.hasTable('bundle_billing_plans');

  if (!planBundlesExists || !clientPlanBundlesExists || !bundleBillingPlansExists) {
    console.log('  ⚠ Legacy tables not found, skipping verification (likely already cleaned up)');
    return;
  }

  const [{ count: planBundles }] = await knex('plan_bundles').count('* as count');
  const [{ count: contracts }] = await knex('contracts').count('* as count');
  if (planBundles !== contracts) {
    throw new Error(`Row count mismatch: plan_bundles=${planBundles}, contracts=${contracts}`);
  }

  const [{ count: clientPlanBundles }] = await knex('client_plan_bundles').count('* as count');
  const [{ count: clientContracts }] = await knex('client_contracts').count('* as count');
  if (clientPlanBundles !== clientContracts) {
    throw new Error(`Row count mismatch: client_plan_bundles=${clientPlanBundles}, client_contracts=${clientContracts}`);
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

  const billingPlansExists = await knex.schema.hasTable('billing_plans');
  const clientBillingPlansExists = await knex.schema.hasTable('client_billing_plans');

  if (!billingPlansExists || !clientBillingPlansExists) {
    console.log('  ⚠ Legacy tables not found, skipping verification (likely already cleaned up)');
    return;
  }

  const [{ count: billingPlans }] = await knex('billing_plans').count('* as count');
  const [{ count: contractLines }] = await knex('contract_lines').count('* as count');
  if (billingPlans !== contractLines) {
    throw new Error(`Row count mismatch: billing_plans=${billingPlans}, contract_lines=${contractLines}`);
  }

  const [{ count: clientBillingPlans }] = await knex('client_billing_plans').count('* as count');
  const [{ count: clientContractLines }] = await knex('client_contract_lines').count('* as count');
  if (clientBillingPlans !== clientContractLines) {
    throw new Error(`Row count mismatch: client_billing_plans=${clientBillingPlans}, client_contract_lines=${clientContractLines}`);
  }

  const timeEntriesExists = await knex.schema.hasTable('time_entries');
  if (timeEntriesExists) {
    const hasBillingPlanId = await knex.schema.hasColumn('time_entries', 'billing_plan_id');
    const hasContractLineId = await knex.schema.hasColumn('time_entries', 'contract_line_id');

    if (hasBillingPlanId && hasContractLineId) {
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
  }

  const usageTrackingExists = await knex.schema.hasTable('usage_tracking');
  if (usageTrackingExists) {
    const hasBillingPlanId = await knex.schema.hasColumn('usage_tracking', 'billing_plan_id');
    const hasContractLineId = await knex.schema.hasColumn('usage_tracking', 'contract_line_id');

    if (hasBillingPlanId && hasContractLineId) {
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
  }

  const planServiceConfigExists = await knex.schema.hasTable('plan_service_configuration');
  if (planServiceConfigExists) {
    const hasPlanId = await knex.schema.hasColumn('plan_service_configuration', 'plan_id');
    const hasContractLineId = await knex.schema.hasColumn('plan_service_configuration', 'contract_line_id');

    if (hasPlanId && hasContractLineId) {
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
  }

  console.log('  ✓ Verified contract line backfills');
}

async function migrateServiceTables(knex, state) {
  console.log('--- Service tables workstream (plan_* → contract_line_*) ---');

  await createContractLineServices(knex, state);
  await createContractLineServiceConfiguration(knex, state);
  await createContractLineDiscounts(knex, state);
  await createContractLineServiceBucketConfig(knex, state);
  await createContractLineServiceFixedConfig(knex, state);
  await createContractLineServiceHourlyConfig(knex, state);
  await createContractLineServiceHourlyConfigs(knex, state);
  await createContractLineServiceRateTiers(knex, state);
  await createContractLineServiceUsageConfig(knex, state);
}

async function createContractLineServices(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_services');
  if (exists) {
    console.log('contract_line_services table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_services table...');
  state.createdTables.push('contract_line_services');

  await knex.schema.createTable('contract_line_services', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('service_id').notNullable();
    table.integer('quantity');
    table.bigInteger('custom_rate');
    table.uuid('contract_line_id').notNullable();

    table.primary(['tenant', 'service_id', 'contract_line_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_services', 'contract_line_services_tenant_fkey');

  const planServicesExists = await knex.schema.hasTable('plan_services');
  if (!planServicesExists) {
    console.log('  ⚠ plan_services table not found, skipping backfill');
    return;
  }

  // Check if plan_services has contract_line_id (from migration) or plan_id (legacy)
  const hasContractLineId = await knex.schema.hasColumn('plan_services', 'contract_line_id');
  const hasPlanId = await knex.schema.hasColumn('plan_services', 'plan_id');

  if (!hasContractLineId && !hasPlanId) {
    console.log('  ⚠ plan_services has neither contract_line_id nor plan_id, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_services from plan_services...');

  const sourceColumn = hasContractLineId ? 'contract_line_id' : 'plan_id';
  await knex.raw(`
    INSERT INTO contract_line_services (tenant, service_id, quantity, custom_rate, contract_line_id)
    SELECT tenant, service_id, quantity, custom_rate, ${sourceColumn}
    FROM plan_services
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_services').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_services`);
}

async function createContractLineServiceConfiguration(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_service_configuration');
  if (exists) {
    console.log('contract_line_service_configuration table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_service_configuration table...');
  state.createdTables.push('contract_line_service_configuration');

  await knex.schema.createTable('contract_line_service_configuration', (table) => {
    table.uuid('config_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('service_id').notNullable();
    table.string('configuration_type', 50).notNullable();
    table.decimal('custom_rate', 10, 2);
    table.integer('quantity');
    table.uuid('tenant').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.uuid('contract_line_id').notNullable();

    table.primary(['tenant', 'config_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_service_configuration', 'contract_line_service_configuration_tenant_fkey');

  const planServiceConfigurationExists = await knex.schema.hasTable('plan_service_configuration');
  if (!planServiceConfigurationExists) {
    console.log('  ⚠ plan_service_configuration table not found, skipping backfill');
    return;
  }

  // Check if plan_service_configuration has contract_line_id (from migration) or plan_id (legacy)
  const hasContractLineId = await knex.schema.hasColumn('plan_service_configuration', 'contract_line_id');
  const hasPlanId = await knex.schema.hasColumn('plan_service_configuration', 'plan_id');

  if (!hasContractLineId && !hasPlanId) {
    console.log('  ⚠ plan_service_configuration has neither contract_line_id nor plan_id, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_service_configuration from plan_service_configuration...');

  const sourceColumn = hasContractLineId ? 'contract_line_id' : 'plan_id';
  await knex.raw(`
    INSERT INTO contract_line_service_configuration
      (config_id, service_id, configuration_type, custom_rate, quantity, tenant, created_at, updated_at, contract_line_id)
    SELECT config_id, service_id, configuration_type, custom_rate, quantity, tenant, created_at, updated_at, ${sourceColumn}
    FROM plan_service_configuration
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_service_configuration').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_service_configuration`);
}

async function createContractLineDiscounts(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_discounts');
  if (exists) {
    console.log('contract_line_discounts table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_discounts table...');
  state.createdTables.push('contract_line_discounts');

  await knex.schema.createTable('contract_line_discounts', (table) => {
    table.uuid('discount_id').notNullable();
    table.uuid('tenant').notNullable();
    table.uuid('client_id');
    table.uuid('contract_line_id').notNullable();

    table.primary(['tenant', 'discount_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_discounts', 'contract_line_discounts_tenant_fkey');

  const planDiscountsExists = await knex.schema.hasTable('plan_discounts');
  if (!planDiscountsExists) {
    console.log('  ⚠ plan_discounts table not found, skipping backfill');
    return;
  }

  // Check if plan_discounts has contract_line_id (from migration) or plan_id (legacy)
  const hasContractLineId = await knex.schema.hasColumn('plan_discounts', 'contract_line_id');
  const hasPlanId = await knex.schema.hasColumn('plan_discounts', 'plan_id');

  if (!hasContractLineId && !hasPlanId) {
    console.log('  ⚠ plan_discounts has neither contract_line_id nor plan_id, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_discounts from plan_discounts...');

  const sourceColumn = hasContractLineId ? 'contract_line_id' : 'plan_id';
  await knex.raw(`
    INSERT INTO contract_line_discounts (discount_id, tenant, client_id, contract_line_id)
    SELECT discount_id, tenant, client_id, ${sourceColumn}
    FROM plan_discounts
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_discounts').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_discounts`);
}

async function createContractLineServiceBucketConfig(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_service_bucket_config');
  if (exists) {
    console.log('contract_line_service_bucket_config table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_service_bucket_config table...');
  state.createdTables.push('contract_line_service_bucket_config');

  await knex.schema.createTable('contract_line_service_bucket_config', (table) => {
    table.uuid('config_id').notNullable();
    table.uuid('tenant').notNullable();
    table.integer('total_minutes').notNullable();
    table.string('billing_period').notNullable().defaultTo('monthly');
    table.decimal('overage_rate', 10, 2).notNullable().defaultTo(0);
    table.boolean('allow_rollover').notNullable().defaultTo(false);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.primary(['tenant', 'config_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_service_bucket_config', 'contract_line_service_bucket_config_tenant_fkey');

  const planServiceBucketConfigExists = await knex.schema.hasTable('plan_service_bucket_config');
  if (!planServiceBucketConfigExists) {
    console.log('  ⚠ plan_service_bucket_config table not found, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_service_bucket_config from plan_service_bucket_config...');
  await knex.raw(`
    INSERT INTO contract_line_service_bucket_config
      (config_id, tenant, total_minutes, billing_period, overage_rate, allow_rollover, created_at, updated_at)
    SELECT config_id, tenant, total_minutes, billing_period, overage_rate, allow_rollover, created_at, updated_at
    FROM plan_service_bucket_config
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_service_bucket_config').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_service_bucket_config`);
}

async function createContractLineServiceFixedConfig(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_service_fixed_config');
  if (exists) {
    console.log('contract_line_service_fixed_config table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_service_fixed_config table...');
  state.createdTables.push('contract_line_service_fixed_config');

  await knex.schema.createTable('contract_line_service_fixed_config', (table) => {
    table.uuid('config_id').notNullable();
    table.uuid('tenant').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.decimal('base_rate', 10, 2);

    table.primary(['tenant', 'config_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_service_fixed_config', 'contract_line_service_fixed_config_tenant_fkey');

  const planServiceFixedConfigExists = await knex.schema.hasTable('plan_service_fixed_config');
  if (!planServiceFixedConfigExists) {
    console.log('  ⚠ plan_service_fixed_config table not found, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_service_fixed_config from plan_service_fixed_config...');
  await knex.raw(`
    INSERT INTO contract_line_service_fixed_config (config_id, tenant, created_at, updated_at, base_rate)
    SELECT config_id, tenant, created_at, updated_at, base_rate
    FROM plan_service_fixed_config
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_service_fixed_config').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_service_fixed_config`);
}

async function createContractLineServiceHourlyConfig(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_service_hourly_config');
  if (exists) {
    console.log('contract_line_service_hourly_config table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_service_hourly_config table...');
  state.createdTables.push('contract_line_service_hourly_config');

  await knex.schema.createTable('contract_line_service_hourly_config', (table) => {
    table.uuid('config_id').notNullable();
    table.uuid('tenant').notNullable();
    table.integer('minimum_billable_time').notNullable().defaultTo(15);
    table.integer('round_up_to_nearest').notNullable().defaultTo(15);
    table.boolean('enable_overtime').notNullable().defaultTo(false);
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold');
    table.boolean('enable_after_hours_rate').notNullable().defaultTo(false);
    table.decimal('after_hours_multiplier', 10, 2);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.primary(['tenant', 'config_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_service_hourly_config', 'contract_line_service_hourly_config_tenant_fkey');

  const planServiceHourlyConfigExists = await knex.schema.hasTable('plan_service_hourly_config');
  if (!planServiceHourlyConfigExists) {
    console.log('  ⚠ plan_service_hourly_config table not found, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_service_hourly_config from plan_service_hourly_config...');
  await knex.raw(`
    INSERT INTO contract_line_service_hourly_config
      (config_id, tenant, minimum_billable_time, round_up_to_nearest, enable_overtime, overtime_rate,
       overtime_threshold, enable_after_hours_rate, after_hours_multiplier, created_at, updated_at)
    SELECT config_id, tenant, minimum_billable_time, round_up_to_nearest, enable_overtime, overtime_rate,
       overtime_threshold, enable_after_hours_rate, after_hours_multiplier, created_at, updated_at
    FROM plan_service_hourly_config
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_service_hourly_config').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_service_hourly_config`);
}

async function createContractLineServiceHourlyConfigs(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_service_hourly_configs');
  if (exists) {
    console.log('contract_line_service_hourly_configs table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_service_hourly_configs table...');
  state.createdTables.push('contract_line_service_hourly_configs');

  await knex.schema.createTable('contract_line_service_hourly_configs', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.decimal('hourly_rate', 10, 2).notNullable();
    table.integer('minimum_billable_time').notNullable();
    table.integer('round_up_to_nearest').notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.primary(['tenant', 'config_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_service_hourly_configs', 'contract_line_service_hourly_configs_tenant_fkey');

  const planServiceHourlyConfigsExists = await knex.schema.hasTable('plan_service_hourly_configs');
  if (!planServiceHourlyConfigsExists) {
    console.log('  ⚠ plan_service_hourly_configs table not found, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_service_hourly_configs from plan_service_hourly_configs...');
  await knex.raw(`
    INSERT INTO contract_line_service_hourly_configs
      (tenant, config_id, hourly_rate, minimum_billable_time, round_up_to_nearest, created_at, updated_at)
    SELECT tenant, config_id, hourly_rate, minimum_billable_time, round_up_to_nearest, created_at, updated_at
    FROM plan_service_hourly_configs
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_service_hourly_configs').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_service_hourly_configs`);
}

async function createContractLineServiceRateTiers(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_service_rate_tiers');
  if (exists) {
    console.log('contract_line_service_rate_tiers table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_service_rate_tiers table...');
  state.createdTables.push('contract_line_service_rate_tiers');

  await knex.schema.createTable('contract_line_service_rate_tiers', (table) => {
    table.uuid('tier_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('config_id').notNullable();
    table.uuid('tenant').notNullable();
    table.integer('min_quantity').notNullable();
    table.integer('max_quantity');
    table.decimal('rate', 10, 2).notNullable();
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();

    table.primary(['tenant', 'tier_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_service_rate_tiers', 'contract_line_service_rate_tiers_tenant_fkey');

  const planServiceRateTiersExists = await knex.schema.hasTable('plan_service_rate_tiers');
  if (!planServiceRateTiersExists) {
    console.log('  ⚠ plan_service_rate_tiers table not found, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_service_rate_tiers from plan_service_rate_tiers...');
  await knex.raw(`
    INSERT INTO contract_line_service_rate_tiers
      (tier_id, config_id, tenant, min_quantity, max_quantity, rate, created_at, updated_at)
    SELECT tier_id, config_id, tenant, min_quantity, max_quantity, rate, created_at, updated_at
    FROM plan_service_rate_tiers
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_service_rate_tiers').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_service_rate_tiers`);
}

async function createContractLineServiceUsageConfig(knex, state) {
  const exists = await knex.schema.hasTable('contract_line_service_usage_config');
  if (exists) {
    console.log('contract_line_service_usage_config table already exists, skipping');
    return;
  }

  console.log('Creating contract_line_service_usage_config table...');
  state.createdTables.push('contract_line_service_usage_config');

  await knex.schema.createTable('contract_line_service_usage_config', (table) => {
    table.uuid('config_id').notNullable();
    table.uuid('tenant').notNullable();
    table.string('unit_of_measure').notNullable().defaultTo('Unit');
    table.boolean('enable_tiered_pricing').notNullable().defaultTo(false);
    table.integer('minimum_usage').notNullable().defaultTo(0);
    table.timestamp('created_at').defaultTo(knex.fn.now()).notNullable();
    table.timestamp('updated_at').defaultTo(knex.fn.now()).notNullable();
    table.decimal('base_rate', 10, 2);

    table.primary(['tenant', 'config_id']);
  });

  await addTenantForeignKey(knex, 'contract_line_service_usage_config', 'contract_line_service_usage_config_tenant_fkey');

  const planServiceUsageConfigExists = await knex.schema.hasTable('plan_service_usage_config');
  if (!planServiceUsageConfigExists) {
    console.log('  ⚠ plan_service_usage_config table not found, skipping backfill');
    return;
  }

  console.log('Backfilling contract_line_service_usage_config from plan_service_usage_config...');
  await knex.raw(`
    INSERT INTO contract_line_service_usage_config
      (config_id, tenant, unit_of_measure, enable_tiered_pricing, minimum_usage, created_at, updated_at, base_rate)
    SELECT config_id, tenant, unit_of_measure, enable_tiered_pricing, minimum_usage, created_at, updated_at, base_rate
    FROM plan_service_usage_config
    ON CONFLICT DO NOTHING
  `);

  const [{ count }] = await knex('contract_line_service_usage_config').count('* as count');
  console.log(`  ✓ Backfilled ${count} contract_line_service_usage_config`);
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
