/**
 * Distribute the project billing tables on Citus using tenant as the distribution key.
 */
exports.config = { transaction: false };

const TABLES = [
  'project_billing_configs',
  'project_billing_schedule_entries',
  'project_phase_rate_overrides',
  'project_billing_cap_usage'
];

const INTERNAL_FOREIGN_KEYS = [
  {
    table: 'project_billing_schedule_entries',
    constraint: 'project_billing_schedule_entries_config_fk',
    sql: `
      ALTER TABLE project_billing_schedule_entries
      ADD CONSTRAINT project_billing_schedule_entries_config_fk
      FOREIGN KEY (tenant, config_id)
      REFERENCES project_billing_configs (tenant, config_id)
      ON DELETE CASCADE
    `
  },
  {
    table: 'project_billing_cap_usage',
    constraint: 'project_billing_cap_usage_config_fk',
    sql: `
      ALTER TABLE project_billing_cap_usage
      ADD CONSTRAINT project_billing_cap_usage_config_fk
      FOREIGN KEY (tenant, config_id)
      REFERENCES project_billing_configs (tenant, config_id)
      ON DELETE CASCADE
    `
  }
];

async function isCitusEnabled(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);
  return Boolean(result.rows?.[0]?.enabled);
}

async function isInRecovery(knex) {
  const result = await knex.raw('SELECT pg_is_in_recovery() AS in_recovery');
  return Boolean(result.rows?.[0]?.in_recovery);
}

async function isDistributed(knex, table) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_dist_partition
      WHERE logicalrelid = ?::regclass
    ) AS distributed
  `, [table]);
  return Boolean(result.rows?.[0]?.distributed);
}

async function constraintExists(knex, table, constraint) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = ?::regclass
        AND conname = ?
    ) AS present
  `, [table, constraint]);
  return Boolean(result.rows?.[0]?.present);
}

async function dropInternalForeignKeys(knex) {
  for (const foreignKey of INTERNAL_FOREIGN_KEYS) {
    if (!await knex.schema.hasTable(foreignKey.table)) continue;
    await knex.raw(`ALTER TABLE ${foreignKey.table} DROP CONSTRAINT IF EXISTS ${foreignKey.constraint}`);
  }
}

async function restoreInternalForeignKeys(knex) {
  const configExists = await knex.schema.hasTable('project_billing_configs');
  if (!configExists) return;

  for (const foreignKey of INTERNAL_FOREIGN_KEYS) {
    if (!await knex.schema.hasTable(foreignKey.table)) continue;
    if (await constraintExists(knex, foreignKey.table, foreignKey.constraint)) continue;
    await knex.raw(foreignKey.sql);
  }
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  if (await isInRecovery(knex)) {
    console.log('Database is in recovery mode (read replica). Skipping Citus distribution.');
    return;
  }
  if (!await isCitusEnabled(knex)) {
    console.log('Citus not enabled, skipping project billing table distribution');
    return;
  }

  // The two child-to-config FKs must be absent while the related local tables
  // transition into the same Citus colocation group.
  await dropInternalForeignKeys(knex);

  for (const table of TABLES) {
    if (!await knex.schema.hasTable(table)) {
      console.log(`${table} does not exist, skipping distribution`);
      continue;
    }
    if (await isDistributed(knex, table)) {
      console.log(`${table} already distributed`);
      continue;
    }

    console.log(`Distributing ${table}...`);
    await knex.raw(
      `SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'tenants')`,
      [table]
    );
    console.log(`✓ Distributed ${table}`);
  }

  await restoreInternalForeignKeys(knex);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  if (await isInRecovery(knex)) {
    console.log('Database is in recovery mode (read replica). Skipping Citus undistribution.');
    return;
  }
  if (!await isCitusEnabled(knex)) return;

  await dropInternalForeignKeys(knex);

  for (const table of [...TABLES].reverse()) {
    if (!await knex.schema.hasTable(table)) continue;
    if (!await isDistributed(knex, table)) continue;

    console.log(`Undistributing ${table}...`);
    await knex.raw(`SELECT undistribute_table(?::regclass)`, [table]);
    console.log(`✓ Undistributed ${table}`);
  }

  await restoreInternalForeignKeys(knex);
};
