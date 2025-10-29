const isCitusEnabled = async (knex) => {
  const { rows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  return rows.length > 0;
};

const isTableDistributed = async (knex, tableName) => {
  const { rows } = await knex.raw(
    'SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass LIMIT 1',
    [tableName]
  );
  return rows.length > 0;
};

const ensureDistributed = async (knex, tableName, distributionColumn) => {
  if (!(await isCitusEnabled(knex))) {
    return false;
  }

  if (await isTableDistributed(knex, tableName)) {
    return false;
  }

  await knex.raw('SELECT create_distributed_table(?, ?)', [tableName, distributionColumn]);
  return true;
};

exports.up = async function up(knex) {
  // Extend contract_lines with contract-specific metadata
  const hasContractId = await knex.schema.hasColumn('contract_lines', 'contract_id');
  if (!hasContractId) {
    await knex.schema.alterTable('contract_lines', (table) => {
      table.uuid('contract_id');
    });
  }

  const hasDisplayOrder = await knex.schema.hasColumn('contract_lines', 'display_order');
  if (!hasDisplayOrder) {
    await knex.schema.alterTable('contract_lines', (table) => {
      table.integer('display_order').notNullable().defaultTo(0);
    });
  }

  const hasCustomRate = await knex.schema.hasColumn('contract_lines', 'custom_rate');
  if (!hasCustomRate) {
    await knex.schema.alterTable('contract_lines', (table) => {
      table.decimal('custom_rate', 10, 2);
    });
  }

  const hasBillingTiming = await knex.schema.hasColumn('contract_lines', 'billing_timing');
  if (!hasBillingTiming) {
    await knex.schema.alterTable('contract_lines', (table) => {
      table.string('billing_timing', 16).notNullable().defaultTo('arrears');
    });
  }

  const contractFkExists = await knex
    .raw(
      `
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_name = 'contract_lines'
        AND constraint_name = 'contract_lines_contract_fk'
        AND constraint_type = 'FOREIGN KEY'
    `
    )
    .then((result) => result.rowCount > 0);

  if (!contractFkExists) {
    await knex.schema.alterTable('contract_lines', (table) => {
      // Citus disallows cascading actions on distributed foreign keys; remove the cascade and handle deletes externally.
      table
        .foreign(['tenant', 'contract_id'], 'contract_lines_contract_fk')
        .references(['tenant', 'contract_id'])
        .inTable('contracts');
    });
  }

  const hasTemplateDisplayOrder = await knex.schema.hasColumn('contract_template_lines', 'display_order');
  if (!hasTemplateDisplayOrder) {
    await knex.schema.alterTable('contract_template_lines', (table) => {
      table.integer('display_order').notNullable().defaultTo(0);
    });
  }

  const hasTemplateCustomRate = await knex.schema.hasColumn('contract_template_lines', 'custom_rate');
  if (!hasTemplateCustomRate) {
    await knex.schema.alterTable('contract_template_lines', (table) => {
      table.decimal('custom_rate', 10, 2);
    });
  }

  const hasTemplateBillingTiming = await knex.schema.hasColumn('contract_template_lines', 'billing_timing');
  if (!hasTemplateBillingTiming) {
    await knex.schema.alterTable('contract_template_lines', (table) => {
      table.string('billing_timing', 16).notNullable().defaultTo('arrears');
    });
  }

  // Migrate template mappings into contract_template_lines
  const templateMappingExists = await knex.schema.hasTable('contract_template_line_mappings');
  if (templateMappingExists) {
    const templateMappingHasBillingTiming = await knex.schema.hasColumn('contract_template_line_mappings', 'billing_timing');
    const templateBillingTimingExpr = templateMappingHasBillingTiming ? 'map.billing_timing' : `'arrears'`;

    await knex.raw(`
      UPDATE contract_template_lines AS ctl
      SET
        display_order = COALESCE(map.display_order, ctl.display_order),
        custom_rate   = map.custom_rate,
        billing_timing = COALESCE(${templateBillingTimingExpr}, ctl.billing_timing, 'arrears'),
        updated_at    = NOW()
      FROM contract_template_line_mappings AS map
      WHERE ctl.template_line_id = map.template_line_id
        AND ctl.tenant = map.tenant
    `);
  }

  // Migrate contract mappings into contract_lines
  const mappingExists = await knex.schema.hasTable('contract_line_mappings');
  if (mappingExists) {
    const contractMappingHasBillingTiming = await knex.schema.hasColumn('contract_line_mappings', 'billing_timing');
    const contractBillingTimingExpr = contractMappingHasBillingTiming ? 'map.billing_timing' : `'arrears'`;

    await knex.raw(`
      UPDATE contract_lines AS cl
      SET
        contract_id    = map.contract_id,
        custom_rate    = map.custom_rate,
        display_order  = COALESCE(map.display_order, cl.display_order),
        billing_timing = COALESCE(${contractBillingTimingExpr}, cl.billing_timing, 'arrears'),
        is_template    = FALSE,
        updated_at     = NOW()
      FROM contract_line_mappings AS map
      WHERE cl.contract_line_id = map.contract_line_id
        AND cl.tenant = map.tenant
    `);
  }

  // Drop mapping tables now that data is inlined
  if (mappingExists) {
    await knex.schema.dropTable('contract_line_mappings');
  }
  if (templateMappingExists) {
    await knex.schema.dropTable('contract_template_line_mappings');
  }

  if (await knex.schema.hasColumn('contract_lines', 'tenant')) {
    await ensureDistributed(knex, 'contract_lines', 'tenant');
  }

  if (await knex.schema.hasColumn('contract_template_lines', 'tenant')) {
    await ensureDistributed(knex, 'contract_template_lines', 'tenant');
  }
};

exports.down = async function down(knex) {
  // Recreate mapping tables
  const hasContractMappings = await knex.schema.hasTable('contract_line_mappings');

  if (!hasContractMappings) {
    await knex.schema.createTable('contract_line_mappings', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('contract_id').notNullable();
      table.uuid('contract_line_id').notNullable();
      table.integer('display_order').defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.decimal('custom_rate', 10, 2);
      table.string('billing_timing', 16).notNullable().defaultTo('arrears');
      table.primary(['tenant', 'contract_id', 'contract_line_id']);
      table.index(['contract_id']);
      table.index(['contract_line_id']);
      table.index(['tenant']);
    });

    await ensureDistributed(knex, 'contract_line_mappings', 'tenant');
  }

  const hasTemplateMappings = await knex.schema.hasTable('contract_template_line_mappings');
  if (!hasTemplateMappings) {
    await knex.schema.createTable('contract_template_line_mappings', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_id').notNullable();
      table.uuid('template_line_id').notNullable();
      table.integer('display_order').defaultTo(0);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.decimal('custom_rate', 10, 2);
      table.primary(['tenant', 'template_id', 'template_line_id']);
      table.index(['template_id']);
      table.index(['template_line_id']);
      table.index(['tenant']);
    });

    await ensureDistributed(knex, 'contract_template_line_mappings', 'tenant');
  }

  // Rehydrate mapping data from inlined columns
  const contractLineRows = await knex('contract_lines')
    .select('tenant', 'contract_id', 'contract_line_id', 'display_order', 'custom_rate', 'billing_timing')
    .whereNotNull('contract_id');

  if (contractLineRows.length > 0) {
    await knex('contract_line_mappings').insert(contractLineRows);
  }

  const templateLineRows = await knex('contract_template_lines')
    .select('tenant', 'template_id', 'template_line_id', 'display_order', 'custom_rate');

  if (templateLineRows.length > 0) {
    await knex('contract_template_line_mappings').insert(templateLineRows);
  }

  // Reset is_template flag since contract-specific metadata is removed
  await knex('contract_lines').update({ is_template: true });

  // Remove contract-specific columns from contract_lines if they exist
  const hasContractId = await knex.schema.hasColumn('contract_lines', 'contract_id');
  if (hasContractId) {
    await knex.schema.alterTable('contract_lines', (table) => {
      table.dropColumn('contract_id');
      table.dropColumn('custom_rate');
      table.dropColumn('display_order');
      table.dropColumn('billing_timing');
    });
  }

  const hasTemplateDisplayOrder = await knex.schema.hasColumn('contract_template_lines', 'display_order');
  if (hasTemplateDisplayOrder) {
    await knex.schema.alterTable('contract_template_lines', (table) => {
      table.dropColumn('display_order');
      table.dropColumn('custom_rate');
      table.dropColumn('billing_timing');
    });
  }
};
