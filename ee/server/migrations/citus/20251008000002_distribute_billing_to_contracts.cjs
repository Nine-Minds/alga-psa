/**
 * Citus distribution for combined contracts + contract lines migration.
 *
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  const inRecovery = await knex.raw('SELECT pg_is_in_recovery() AS in_recovery');
  if (inRecovery.rows[0].in_recovery) {
    console.log('Database is in recovery mode (read replica). Skipping Citus distribution.');
    return;
  }

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);

  if (!citusEnabled.rows[0].enabled) {
    console.log('Citus not enabled, skipping distribution');
    return;
  }

  console.log('='.repeat(80));
  console.log('Starting combined Citus distribution for contracts + contract lines...');
  console.log('='.repeat(80));

  await distributeContractsTables(knex);
  await distributeContractLineTables(knex);

  console.log('='.repeat(80));
  console.log('✓ Combined Citus distribution completed');
  console.log('='.repeat(80));
};

exports.down = async function down(knex) {
  // No-op: distribution changes are reversible via citus utility functions but
  // we leave them in place during down migrations.
  console.log('Skipping down migration for Citus distribution (no-op)');
};

async function distributeContractsTables(knex) {
  console.log('--- Distributing contracts tables ---');

  await distributeContractsTable(knex);
  await distributeClientContractsTable(knex);
  await distributeContractLineMappingsTable(knex);
}

async function distributeContractLineTables(knex) {
  console.log('--- Distributing contract line tables ---');

  await undistributeBillingPlans(knex);
  await distributeContractLinesTable(knex);
  await distributeClientContractLinesTable(knex);
  await distributeContractLineFixedConfigTable(knex);
}

async function distributeContractsTable(knex) {
  console.log('Processing contracts table...');

  const exists = await knex.schema.hasTable('contracts');
  if (!exists) {
    console.log('  contracts table not found, skipping');
    return;
  }

  await undistributeTable(knex, 'plan_bundles');

  const distributed = await isTableDistributed(knex, 'contracts');
  if (distributed) {
    console.log('  contracts table already distributed');
    return;
  }

  await captureDropAndDistribute(knex, 'contracts', 'tenant');
  await recreateUniqueIndex(knex, 'contracts', 'contracts_tenant_contract_id_unique', 'contracts(tenant, contract_id)');
}

async function distributeClientContractsTable(knex) {
  console.log('Processing client_contracts table...');

  const exists = await knex.schema.hasTable('client_contracts');
  if (!exists) {
    console.log('  client_contracts not found, skipping');
    return;
  }

  const distributed = await isTableDistributed(knex, 'client_contracts');
  if (distributed) {
    console.log('  client_contracts already distributed');
    return;
  }

  await captureDropAndDistribute(knex, 'client_contracts', 'tenant');
  await recreateUniqueIndex(knex, 'client_contracts', 'client_contracts_tenant_client_contract_id_unique', 'client_contracts(tenant, client_contract_id)');
}

async function distributeContractLineMappingsTable(knex) {
  console.log('Processing contract_line_mappings table...');

  const exists = await knex.schema.hasTable('contract_line_mappings');
  if (!exists) {
    console.log('  contract_line_mappings not found, skipping');
    return;
  }

  const distributed = await isTableDistributed(knex, 'contract_line_mappings');
  if (distributed) {
    console.log('  contract_line_mappings already distributed');
    return;
  }

  await captureDropAndDistribute(knex, 'contract_line_mappings', 'tenant');
}

async function undistributeBillingPlans(knex) {
  const exists = await knex.schema.hasTable('billing_plans');
  if (!exists) {
    return;
  }

  const distributed = await isTableDistributed(knex, 'billing_plans');
  if (!distributed) {
    return;
  }

  console.log('Undistributing legacy billing_plans table...');

  await dropForeignKeysReferencing(knex, 'billing_plans');
  await dropForeignKeysOnTable(knex, 'billing_plans');

  try {
    await knex.raw(`SELECT undistribute_table('billing_plans', cascade_via_foreign_keys=>true)`);
    console.log('  ✓ Undistributed billing_plans');
  } catch (error) {
    console.log(`  ⚠ Failed to undistribute billing_plans: ${error.message}`);
  }
}

async function distributeContractLinesTable(knex) {
  console.log('Processing contract_lines table...');

  const exists = await knex.schema.hasTable('contract_lines');
  if (!exists) {
    console.log('  contract_lines not found, skipping');
    return;
  }

  const distributed = await isTableDistributed(knex, 'contract_lines');
  if (distributed) {
    console.log('  contract_lines already distributed');
    return;
  }

  await captureDropAndDistribute(knex, 'contract_lines', 'tenant');
}

async function distributeClientContractLinesTable(knex) {
  console.log('Processing client_contract_lines table...');

  const exists = await knex.schema.hasTable('client_contract_lines');
  if (!exists) {
    console.log('  client_contract_lines not found, skipping');
    return;
  }

  const distributed = await isTableDistributed(knex, 'client_contract_lines');
  if (distributed) {
    console.log('  client_contract_lines already distributed');
    return;
  }

  await captureDropAndDistribute(knex, 'client_contract_lines', 'tenant');
}

async function distributeContractLineFixedConfigTable(knex) {
  console.log('Processing contract_line_fixed_config table...');

  const exists = await knex.schema.hasTable('contract_line_fixed_config');
  if (!exists) {
    console.log('  contract_line_fixed_config not found, skipping');
    return;
  }

  const distributed = await isTableDistributed(knex, 'contract_line_fixed_config');
  if (distributed) {
    console.log('  contract_line_fixed_config already distributed');
    return;
  }

  await captureDropAndDistribute(knex, 'contract_line_fixed_config', 'tenant');
}

async function captureDropAndDistribute(knex, tableName, distributionColumn) {
  const fks = await captureForeignKeys(knex, tableName);
  await dropForeignKeysOnTable(knex, tableName);
  await dropUniqueConstraints(knex, tableName);

  console.log(`  Distributing ${tableName}...`);
  try {
    await knex.raw(`SELECT create_distributed_table('${tableName}', '${distributionColumn}', colocate_with => 'tenants')`);
  } catch (error) {
    console.log(`    Colocation failed for ${tableName}, retrying without colocation...`);
    await knex.raw(`SELECT create_distributed_table('${tableName}', '${distributionColumn}')`);
  }
  console.log(`    ✓ Distributed ${tableName}`);

  await recreateForeignKeys(knex, tableName, fks);
}

async function undistributeTable(knex, tableName) {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    return;
  }

  const distributed = await isTableDistributed(knex, tableName);
  if (!distributed) {
    return;
  }

  console.log(`Undistributing legacy table ${tableName}...`);

  await dropForeignKeysReferencing(knex, tableName);
  await dropForeignKeysOnTable(knex, tableName);

  try {
    await knex.raw(`SELECT undistribute_table('${tableName}', cascade_via_foreign_keys=>true)`);
    console.log(`  ✓ Undistributed ${tableName}`);
  } catch (error) {
    console.log(`  ⚠ Failed to undistribute ${tableName}: ${error.message}`);
  }
}

async function isTableDistributed(knex, tableName) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = '${tableName}'::regclass
    ) AS distributed
  `);
  return result.rows[0].distributed;
}

async function captureForeignKeys(knex, tableName) {
  const result = await knex.raw(`
    SELECT
      conname AS constraint_name,
      pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE c.conrelid = '${tableName}'::regclass
    AND c.contype = 'f'
  `);
  return result.rows;
}

async function dropForeignKeysOnTable(knex, tableName) {
  const fks = await captureForeignKeys(knex, tableName);
  for (const fk of fks) {
    try {
      await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
      console.log(`    Dropped FK ${fk.constraint_name} on ${tableName}`);
    } catch (error) {
      console.log(`    ⚠ Failed to drop FK ${fk.constraint_name} on ${tableName}: ${error.message}`);
    }
  }
}

async function dropForeignKeysReferencing(knex, tableName) {
  const result = await knex.raw(`
    SELECT DISTINCT
      tc.table_name,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage AS ccu USING (constraint_schema, constraint_name)
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = '${tableName}'
      AND ccu.table_schema = current_schema()
  `);

  for (const fk of result.rows) {
    try {
      await knex.raw(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
      console.log(`    Dropped FK ${fk.constraint_name} referencing ${tableName}`);
    } catch (error) {
      console.log(`    ⚠ Failed to drop FK ${fk.constraint_name} referencing ${tableName}: ${error.message}`);
    }
  }
}

async function dropUniqueConstraints(knex, tableName) {
  const uniques = await knex.raw(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = '${tableName}'::regclass
      AND contype = 'u'
  `);

  for (const constraint of uniques.rows) {
    try {
      await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${constraint.conname} CASCADE`);
      console.log(`    Dropped unique constraint ${constraint.conname} on ${tableName}`);
    } catch (error) {
      console.log(`    ⚠ Failed to drop unique constraint ${constraint.conname} on ${tableName}: ${error.message}`);
    }
  }
}

async function recreateForeignKeys(knex, tableName, foreignKeys) {
  for (const fk of foreignKeys) {
    try {
      await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${fk.constraint_name} ${fk.definition}`);
      console.log(`    Recreated FK ${fk.constraint_name} on ${tableName}`);
    } catch (error) {
      console.log(`    ⚠ Failed to recreate FK ${fk.constraint_name} on ${tableName}: ${error.message}`);
    }
  }
}

async function recreateUniqueIndex(knex, tableName, indexName, definition) {
  try {
    await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${definition}`);
    console.log(`    Recreated unique index ${indexName} on ${tableName}`);
  } catch (error) {
    console.log(`    ⚠ Failed to recreate unique index ${indexName} on ${tableName}: ${error.message}`);
  }
}
