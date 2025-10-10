/**
 * Migration 2 Combined Cleanup: finalize contracts + contract line rename.
 *
 * Run only after the application fully depends on the new contract and
 * contract line identifiers. This drops legacy tables/columns and tightens
 * constraints so the system no longer references the old plan/bundle names.
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  console.log('='.repeat(80));
  console.log('Starting combined contracts + contract lines cleanup migration...');
  console.log('WARNING: This will drop legacy billing tables/columns. Ensure dual-write period is complete.');
  console.log('='.repeat(80));

  await addContractForeignKeys(knex);
  await addContractLineForeignKeys(knex);
  await makeContractLineIdNotNull(knex);
  await dropLegacyPlanColumns(knex);
  await dropLegacyBundleColumns(knex);
  await dropLegacyTables(knex);
  await verifyDataIntegrity(knex);
  await finalVerification(knex);

  console.log('='.repeat(80));
  console.log('✓ Combined cleanup migration completed');
  console.log('='.repeat(80));
};

exports.down = async function down(knex) {
  console.log('='.repeat(80));
  console.log('WARNING: Cleanup rollback is best-effort only and may require manual intervention');
  console.log('Restoring dropped tables/columns automatically is not supported.');
  console.log('='.repeat(80));

  console.log('⚠ Legacy tables were dropped and are not recreated automatically.');
};

async function addContractForeignKeys(knex) {
  console.log('Adding permanent foreign keys for contracts tables...');

  const citusEnabled = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);

  const isCitus = citusEnabled.rows[0].enabled;

  try {
    console.log('  Ensuring client_contracts → contracts FK');
    await knex.schema.alterTable('client_contracts', (table) => {
      if (isCitus) {
        table.foreign(['tenant', 'contract_id'])
          .references(['tenant', 'contract_id'])
          .inTable('contracts')
          .onDelete('CASCADE');
      } else {
        table.foreign('contract_id')
          .references('contract_id')
          .inTable('contracts')
          .onDelete('CASCADE');
      }
    });
  } catch (error) {
    console.log(`    ⚠ client_contracts → contracts FK may already exist: ${error.message}`);
  }

  const clientsExists = await knex.schema.hasTable('clients');
  const targetTable = clientsExists ? 'clients' : 'companies';
  const targetColumn = clientsExists ? 'client_id' : 'company_id';

  try {
    console.log(`  Ensuring client_contracts → ${targetTable} FK`);
    await knex.schema.alterTable('client_contracts', (table) => {
      if (isCitus) {
        table.foreign(['tenant', 'client_id'])
          .references(['tenant', targetColumn])
          .inTable(targetTable)
          .onDelete('CASCADE');
      } else {
        table.foreign('client_id')
          .references(targetColumn)
          .inTable(targetTable)
          .onDelete('CASCADE');
      }
    });
  } catch (error) {
    console.log(`    ⚠ client_contracts → ${targetTable} FK may already exist: ${error.message}`);
  }

  try {
    console.log('  Ensuring contract_line_mappings → contracts FK');
    await knex.schema.alterTable('contract_line_mappings', (table) => {
      if (isCitus) {
        table.foreign(['tenant', 'contract_id'])
          .references(['tenant', 'contract_id'])
          .inTable('contracts')
          .onDelete('CASCADE');
      } else {
        table.foreign('contract_id')
          .references('contract_id')
          .inTable('contracts')
          .onDelete('CASCADE');
      }
    });
  } catch (error) {
    console.log(`    ⚠ contract_line_mappings → contracts FK may already exist: ${error.message}`);
  }
}

async function addContractLineForeignKeys(knex) {
  console.log('Adding permanent foreign keys for contract line tables...');

  const tables = [
    { table: 'bucket_usage', fkName: 'bucket_usage_contract_line_fk' },
    { table: 'plan_discounts', fkName: 'plan_discounts_contract_line_fk' },
    { table: 'plan_service_configuration', fkName: 'plan_service_configuration_contract_line_fk' },
    { table: 'plan_services', fkName: 'plan_services_contract_line_fk' },
    { table: 'usage_tracking', fkName: 'usage_tracking_contract_line_fk' },
    { table: 'contract_line_mappings', fkName: 'contract_line_mappings_contract_line_fk' },
  ];

  for (const { table, fkName } of tables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, 'contract_line_id');
    if (!hasColumn) {
      continue;
    }

    const hasTenant = await knex.schema.hasColumn(table, 'tenant');
    if (!hasTenant) {
      continue;
    }

    const existingFk = await knex.raw(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = '${table}'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = '${fkName}'
        AND table_schema = current_schema()
    `);

    if (existingFk.rows.length > 0) {
      continue;
    }

    try {
      console.log(`  Adding ${fkName} on ${table}`);
      await knex.raw(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${fkName}
        FOREIGN KEY (tenant, contract_line_id)
        REFERENCES contract_lines(tenant, contract_line_id)
        ON DELETE CASCADE
      `);
    } catch (error) {
      console.log(`    ⚠ Could not add ${fkName}: ${error.message}`);
    }
  }

  const timeEntriesExists = await knex.schema.hasTable('time_entries');
  if (timeEntriesExists) {
    const fkExists = await knex.raw(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'time_entries'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'time_entries_client_contract_line_fk'
        AND table_schema = current_schema()
    `);

    if (fkExists.rows.length === 0) {
      try {
        console.log('  Adding time_entries_client_contract_line_fk on time_entries');
        await knex.raw(`
          ALTER TABLE time_entries
          ADD CONSTRAINT time_entries_client_contract_line_fk
          FOREIGN KEY (tenant, contract_line_id)
          REFERENCES client_contract_lines(tenant, client_contract_line_id)
          ON DELETE SET NULL
        `);
      } catch (error) {
        console.log(`    ⚠ Could not add FK on time_entries: ${error.message}`);
      }
    }
  }

  const clientContractLinesExists = await knex.schema.hasTable('client_contract_lines');
  if (clientContractLinesExists) {
    const fkExists = await knex.raw(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'client_contract_lines'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'client_contract_lines_contract_line_fk'
        AND table_schema = current_schema()
    `);

    if (fkExists.rows.length === 0) {
      try {
        console.log('  Adding client_contract_lines_contract_line_fk');
        await knex.raw(`
          ALTER TABLE client_contract_lines
          ADD CONSTRAINT client_contract_lines_contract_line_fk
          FOREIGN KEY (tenant, contract_line_id)
          REFERENCES contract_lines(tenant, contract_line_id)
          ON DELETE CASCADE
        `);
      } catch (error) {
        console.log(`    ⚠ Could not add client_contract_lines FK: ${error.message}`);
      }
    }

    const contractFkExists = await knex.raw(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'client_contract_lines'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'client_contract_lines_client_contract_fk'
        AND table_schema = current_schema()
    `);

    if (contractFkExists.rows.length === 0) {
      try {
        console.log('  Adding client_contract_lines_client_contract_fk');
        await knex.raw(`
          ALTER TABLE client_contract_lines
          ADD CONSTRAINT client_contract_lines_client_contract_fk
          FOREIGN KEY (tenant, client_contract_id)
          REFERENCES client_contracts(tenant, client_contract_id)
          ON DELETE SET NULL
        `);
      } catch (error) {
        console.log(`    ⚠ Could not add client_contract_lines → client_contracts FK: ${error.message}`);
      }
    }
  }
}

async function makeContractLineIdNotNull(knex) {
  console.log('Making contract_line_id columns NOT NULL where safe...');

  const tables = [
    'bucket_usage',
    'plan_discounts',
    'plan_service_configuration',
    'plan_services',
    'contract_line_mappings',
  ];

  for (const table of tables) {
    const tableExists = await knex.schema.hasTable(table);
    if (!tableExists) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, 'contract_line_id');
    if (!hasColumn) {
      continue;
    }

    const [{ count }] = await knex(table).whereNull('contract_line_id').count('* as count');
    if (parseInt(count, 10) > 0) {
      console.log(`  ⚠ ${table} still has ${count} NULL contract_line_id values; skipping NOT NULL`);
      continue;
    }

    try {
      await knex.raw(`ALTER TABLE ${table} ALTER COLUMN contract_line_id SET NOT NULL`);
      console.log(`  ✓ Set contract_line_id NOT NULL on ${table}`);
    } catch (error) {
      console.log(`  ⚠ Failed to set NOT NULL on ${table}: ${error.message}`);
    }
  }

  console.log('  Skipping NOT NULL for time_entries/usage_tracking (optional linkage)');
}

async function dropLegacyPlanColumns(knex) {
  console.log('Dropping legacy plan_id/billing_plan_id columns...');

  const planTables = [
    'bucket_usage',
    'plan_discounts',
    'plan_service_configuration',
    'plan_services',
    'contract_line_mappings',
  ];

  for (const table of planTables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, 'plan_id');
    if (!hasColumn) {
      continue;
    }

    await dropColumnWithFk(knex, table, 'plan_id');
  }

  const billingPlanTables = ['time_entries', 'usage_tracking'];

  for (const table of billingPlanTables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      continue;
    }

    const hasColumn = await knex.schema.hasColumn(table, 'billing_plan_id');
    if (!hasColumn) {
      continue;
    }

    await dropColumnWithFk(knex, table, 'billing_plan_id');
  }
}

async function dropLegacyBundleColumns(knex) {
  console.log('Dropping legacy bundle columns...');

  const tableExists = await knex.schema.hasTable('client_billing_plans');
  if (!tableExists) {
    console.log('  client_billing_plans table not found, skipping');
    return;
  }

  const hasColumn = await knex.schema.hasColumn('client_billing_plans', 'client_bundle_id');
  if (!hasColumn) {
    console.log('  client_bundle_id already removed');
    return;
  }

  await dropColumnWithFk(knex, 'client_billing_plans', 'client_bundle_id');
}

async function dropLegacyTables(knex) {
  console.log('Dropping legacy plan/billing tables...');
  console.log('Note: Tables should already be undistributed from step 2 migration');

  const tables = [
    'bundle_billing_plans',
    'client_plan_bundles',
    'plan_bundles',
    'client_billing_plans',
    'billing_plan_fixed_config',
    'billing_plans',
    'plan_services',
    'plan_service_configuration',
    'plan_discounts',
    'plan_service_bucket_config',
    'plan_service_fixed_config',
    'plan_service_hourly_config',
    'plan_service_hourly_configs',
    'plan_service_rate_tiers',
    'plan_service_usage_config',
  ];

  for (const table of tables) {
    const exists = await knex.schema.hasTable(table);
    if (!exists) {
      continue;
    }

    console.log(`  Dropping ${table}...`);
    await knex.raw(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}

async function dropColumnWithFk(knex, tableName, columnName) {
  console.log(`  Dropping column ${tableName}.${columnName}`);

  try {
    const fks = await knex.raw(`
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = '${tableName}'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name LIKE '%${columnName}%'
        AND table_schema = current_schema()
    `);

    for (const fk of fks.rows) {
      await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT IF EXISTS ${fk.constraint_name}`);
    }

    await knex.schema.table(tableName, (table) => {
      table.dropColumn(columnName);
    });
    console.log(`    ✓ Dropped ${columnName} from ${tableName}`);
  } catch (error) {
    console.log(`    ⚠ Could not drop ${columnName} from ${tableName}: ${error.message}`);
  }
}

async function verifyDataIntegrity(knex) {
  console.log('Verifying data integrity after cleanup...');

  const invalidClientContracts = await knex.raw(`
    SELECT COUNT(*) AS count
    FROM client_contracts cc
    LEFT JOIN contracts c ON cc.tenant = c.tenant AND cc.contract_id = c.contract_id
    WHERE c.contract_id IS NULL
  `);

  if (parseInt(invalidClientContracts.rows[0].count, 10) > 0) {
    throw new Error(`Found ${invalidClientContracts.rows[0].count} client_contracts with invalid contract references`);
  }

  const invalidMappings = await knex.raw(`
    SELECT COUNT(*) AS count
    FROM contract_line_mappings clm
    LEFT JOIN contracts c ON clm.tenant = c.tenant AND clm.contract_id = c.contract_id
    WHERE c.contract_id IS NULL
  `);

  if (parseInt(invalidMappings.rows[0].count, 10) > 0) {
    throw new Error(`Found ${invalidMappings.rows[0].count} contract_line_mappings with invalid contract references`);
  }

  console.log('  ✓ Data integrity checks passed');
}

async function finalVerification(knex) {
  console.log('Final verification: ensure new schema is authoritative...');

  const checks = [
    { table: 'contracts', shouldExist: true },
    { table: 'client_contracts', shouldExist: true },
    { table: 'contract_lines', shouldExist: true },
    { table: 'client_contract_lines', shouldExist: true },
    { table: 'plan_bundles', shouldExist: false },
    { table: 'client_plan_bundles', shouldExist: false },
    { table: 'bundle_billing_plans', shouldExist: false },
    { table: 'billing_plans', shouldExist: false },
    { table: 'billing_plan_fixed_config', shouldExist: false },
    { table: 'client_billing_plans', shouldExist: false },
    { table: 'plan_services', shouldExist: false },
    { table: 'plan_service_configuration', shouldExist: false },
    { table: 'plan_discounts', shouldExist: false },
    { table: 'plan_service_bucket_config', shouldExist: false },
    { table: 'plan_service_fixed_config', shouldExist: false },
    { table: 'plan_service_hourly_config', shouldExist: false },
    { table: 'plan_service_hourly_configs', shouldExist: false },
    { table: 'plan_service_rate_tiers', shouldExist: false },
    { table: 'plan_service_usage_config', shouldExist: false },
  ];

  for (const check of checks) {
    const exists = await knex.schema.hasTable(check.table);
    if (check.shouldExist && !exists) {
      throw new Error(`Required table ${check.table} is missing after cleanup`);
    }

    if (!check.shouldExist && exists) {
      throw new Error(`Legacy table ${check.table} still exists after cleanup`);
    }
  }

  const hasContractName = await knex.schema.hasColumn('contracts', 'contract_name');
  if (!hasContractName) {
    throw new Error('contracts.contract_name column missing after rename');
  }

  const hasContractLineName = await knex.schema.hasColumn('contract_lines', 'contract_line_name');
  if (!hasContractLineName) {
    throw new Error('contract_lines.contract_line_name column missing after rename');
  }

  console.log('  ✓ Final verification complete');
}
