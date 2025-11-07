const TABLE_NAME = 'contract_lines';
const FIXED_CONFIG_TABLE = 'contract_line_fixed_config';

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
  // Add new columns to contract_lines
  const hasEnableProration = await knex.schema.hasColumn(TABLE_NAME, 'enable_proration');
  const hasBillingAlignment = await knex.schema.hasColumn(TABLE_NAME, 'billing_cycle_alignment');

  if (!hasEnableProration || !hasBillingAlignment) {
    await knex.schema.alterTable(TABLE_NAME, (table) => {
      if (!hasEnableProration) {
        table.boolean('enable_proration').notNullable().defaultTo(false);
      }
      if (!hasBillingAlignment) {
        table.string('billing_cycle_alignment', 16).notNullable().defaultTo('start');
      }
    });
  }

  // Copy data from contract_line_fixed_config into contract_lines
  const fixedConfigExists = await knex.schema.hasTable(FIXED_CONFIG_TABLE);
  if (fixedConfigExists) {
    await knex.raw(`
      UPDATE contract_lines AS cl
      SET
        custom_rate = COALESCE(cl.custom_rate, cfg.base_rate),
        enable_proration = COALESCE(cfg.enable_proration, cl.enable_proration),
        billing_cycle_alignment = COALESCE(cfg.billing_cycle_alignment, cl.billing_cycle_alignment)
      FROM contract_line_fixed_config AS cfg
      WHERE cl.contract_line_id = cfg.contract_line_id
        AND cl.tenant = cfg.tenant;
    `);
  }

  // Drop the legacy table now that data lives on contract_lines
  if (fixedConfigExists) {
    await knex.schema.dropTable(FIXED_CONFIG_TABLE);
  }

  if (await knex.schema.hasColumn(TABLE_NAME, 'tenant')) {
    await ensureDistributed(knex, TABLE_NAME, 'tenant');
  }
};

exports.down = async function down(knex) {
  const exists = await knex.schema.hasTable(FIXED_CONFIG_TABLE);
  if (!exists) {
    await knex.schema.createTable(FIXED_CONFIG_TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('contract_line_id').notNullable();
      table.decimal('base_rate', 10, 2);
      table.boolean('enable_proration').notNullable().defaultTo(false);
      table.string('billing_cycle_alignment').notNullable().defaultTo('start');
      table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'contract_line_id']);
    });

    await ensureDistributed(knex, FIXED_CONFIG_TABLE, 'tenant');
  }

  await knex.raw(`
    INSERT INTO contract_line_fixed_config (tenant, contract_line_id, base_rate, enable_proration, billing_cycle_alignment, created_at, updated_at)
    SELECT tenant, contract_line_id, custom_rate, enable_proration, billing_cycle_alignment, created_at, updated_at
    FROM contract_lines
    ON CONFLICT (tenant, contract_line_id) DO UPDATE
    SET base_rate = EXCLUDED.base_rate,
        enable_proration = EXCLUDED.enable_proration,
        billing_cycle_alignment = EXCLUDED.billing_cycle_alignment,
        updated_at = NOW();
  `);

  const hasEnableProration = await knex.schema.hasColumn(TABLE_NAME, 'enable_proration');
  const hasBillingAlignment = await knex.schema.hasColumn(TABLE_NAME, 'billing_cycle_alignment');

  if (hasEnableProration || hasBillingAlignment) {
    await knex.schema.alterTable(TABLE_NAME, (table) => {
      if (hasEnableProration) {
        table.dropColumn('enable_proration');
      }
      if (hasBillingAlignment) {
        table.dropColumn('billing_cycle_alignment');
      }
    });
  }

  if (await knex.schema.hasColumn(TABLE_NAME, 'tenant')) {
    await ensureDistributed(knex, TABLE_NAME, 'tenant');
  }
};
