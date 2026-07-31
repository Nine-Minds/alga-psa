const MIGRATION_TENANT = 'migration:20260712101000_add_clients_lifecycle_status';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for client lifecycle status backfill';
const CLIENT_BACKFILL_REASON = 'verify client lifecycle status backfill before enforcing not null';

async function loadTenantDb() {
  return require('./utils/tenantDb.cjs').tenantDb;
}

async function isCitusDistributedTable(knex, tableName) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = ?::regclass
      ) AS is_distributed
    `, [tableName]);
    return Boolean(result.rows?.[0]?.is_distributed);
  } catch (_error) {
    return false;
  }
}

async function setNotNull(knex) {
  if (await isCitusDistributedTable(knex, 'clients')) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        'clients',
        $$ALTER TABLE %s ALTER COLUMN lifecycle_status SET NOT NULL$$
      )
    `);
    await knex.raw(`
      UPDATE pg_attribute
      SET attnotnull = true
      WHERE attrelid = 'clients'::regclass
        AND attname = 'lifecycle_status'
        AND attnotnull = false
    `);
    return;
  }

  await knex.raw('ALTER TABLE clients ALTER COLUMN lifecycle_status SET NOT NULL');
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);

  await knex.schema.alterTable('clients', (table) => {
    table.text('lifecycle_status').nullable();
  });

  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  for (const { tenant } of tenants) {
    await tenantDb(knex, tenant)
      .table('clients')
      .whereNull('lifecycle_status')
      .update({ lifecycle_status: 'active' });
  }

  const incompleteRows = await migrationDb
    .unscoped('clients', CLIENT_BACKFILL_REASON)
    .whereNull('lifecycle_status')
    .count({ count: '*' })
    .first();
  if (Number(incompleteRows?.count ?? 0) > 0) {
    throw new Error('Cannot enforce clients.lifecycle_status NOT NULL; lifecycle backfill left null rows.');
  }

  await knex.raw(`
    ALTER TABLE clients
    ADD CONSTRAINT clients_lifecycle_status_check
    CHECK (lifecycle_status IN ('prospect', 'active', 'former'))
  `);
  await knex.raw("ALTER TABLE clients ALTER COLUMN lifecycle_status SET DEFAULT 'active'");
  await setNotNull(knex);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_lifecycle_status_check');
  await knex.schema.alterTable('clients', (table) => {
    table.dropColumn('lifecycle_status');
  });
};

// ALTER COLUMN ... SET NOT NULL on Citus shards cannot run inside Knex's transaction.
exports.config = { transaction: false };
