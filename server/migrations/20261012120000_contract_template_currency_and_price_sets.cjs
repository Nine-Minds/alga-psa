'use strict';

/**
 * Contract templates carry a currency (card 28cb1ead).
 *
 *  - contract_templates.currency_code: the template's base currency. The amounts
 *    already stored in the template columns are read as base-currency amounts.
 *    Backfilled per tenant from default_billing_settings.default_currency_code
 *    (fallback 'USD'), then NOT NULL with no DB default (every writer supplies it).
 *  - contract_template_price_sets / contract_template_prices: per-currency price
 *    sets for currencies other than the base. The base is never stored here.
 *
 * Citus:
 *  - tables are tenant-first, every UPDATE is parameterized per tenant with tenant
 *    in the WHERE and no column function, and access goes through tenantDb.cjs.
 *  - contract_templates carries a deliberate UNIQUE(template_id), which Citus forbids
 *    on distributed tables, so contract_templates, contract_template_lines and
 *    contract_template_line_buckets are LOCAL coordinator tables (see
 *    20251028090000 and 20260815000000). A distributed table cannot hold a foreign
 *    key to a local table, so the two new tables follow their parents: they are
 *    distributed (by tenant, co-located with contract_templates) ONLY when every
 *    table they reference is itself distributed, otherwise they stay local.
 *  - create_distributed_table cannot run in a transaction, so the migration is
 *    non-transactional and every step is idempotent (column/table/constraint
 *    guards, a backfill that only touches NULL rows).
 *  - SET NOT NULL uses the shard-level pattern from 20260818040000 when the table
 *    is distributed and a plain ALTER otherwise.
 */

const { tenantDb } = require('./utils/tenantDb.cjs');

const MIGRATION_TENANT = 'migration:20261012120000_contract_template_currency_and_price_sets';
const SLOT_KINDS = [
  'line_base_rate',
  'member_rate',
  'line_overtime_rate',
  'member_overtime_rate',
  'bucket_overage_rate',
  'legacy_bucket_overage_rate',
];

exports.SLOT_KINDS = SLOT_KINDS;

/** Pure rule so the backfill can be unit tested. */
function backfillCurrency(settingsCurrency) {
  const code = typeof settingsCurrency === 'string' ? settingsCurrency.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}
exports.backfillCurrency = backfillCurrency;

async function distributionState(knex, tableName) {
  try {
    const result = await knex.raw(
      `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS distributed`,
      [tableName],
    );
    return Boolean(result.rows?.[0]?.distributed);
  } catch {
    return null; // plain Postgres: no Citus catalog
  }
}

async function hasConstraint(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass) AS present`,
    [constraintName, tableName],
  );
  return Boolean(result.rows?.[0]?.present);
}

async function addConstraintIfMissing(knex, tableName, constraintName, definition) {
  if (await hasConstraint(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

async function setNotNull(knex, tableName, columnName) {
  if ((await distributionState(knex, tableName)) === true) {
    await knex.raw(`SELECT * FROM run_command_on_shards(?, $$ALTER TABLE %s ALTER COLUMN ${columnName} SET NOT NULL$$)`, [tableName]);
    await knex.raw(
      `UPDATE pg_attribute SET attnotnull = true WHERE attrelid = ?::regclass AND attname = ? AND attnotnull = false`,
      [tableName, columnName],
    );
    return;
  }
  await knex.raw(`ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET NOT NULL`);
}

/** Distribute by tenant, co-located with contract_templates. No-op on plain Postgres. */
async function distributeIfCitus(knex, tableName) {
  const fn = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS exists`);
  if (!fn.rows?.[0]?.exists) return;
  if ((await distributionState(knex, tableName)) === true) return;
  await knex.raw(`SELECT create_distributed_table(?, 'tenant', colocate_with => 'contract_templates')`, [tableName]);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('contract_templates', 'currency_code'))) {
    await knex.raw('ALTER TABLE contract_templates ADD COLUMN currency_code varchar(3)');
  }

  const tenants = await tenantDb(knex, MIGRATION_TENANT)
    .unscoped('tenants', 'enumerate tenants for contract template currency backfill')
    .select('tenant');
  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const settings = await db.table('default_billing_settings').first('default_currency_code');
    await db.table('contract_templates')
      .whereNull('currency_code')
      .update({ currency_code: backfillCurrency(settings?.default_currency_code) });
  }
  await setNotNull(knex, 'contract_templates', 'currency_code');

  if (!(await knex.schema.hasTable('contract_template_price_sets'))) {
    await knex.schema.createTable('contract_template_price_sets', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_id').notNullable();
      table.string('currency_code', 3).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.uuid('created_by').nullable();
      table.uuid('updated_by').nullable();
      table.primary(['tenant', 'template_id', 'currency_code']);
    });
  }

  if (!(await knex.schema.hasTable('contract_template_prices'))) {
    await knex.schema.createTable('contract_template_prices', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('price_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('template_id').notNullable();
      table.string('currency_code', 3).notNullable();
      table.uuid('template_line_id').notNullable();
      table.text('slot_kind').notNullable();
      table.uuid('service_id').nullable();
      table.uuid('bucket_id').nullable();
      table.text('slot_key').notNullable();
      table.integer('rate').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'price_id']);
      table.unique(['tenant', 'template_id', 'currency_code', 'slot_key'], {
        indexName: 'contract_template_prices_slot_unique',
      });
      table.index(['tenant', 'template_id', 'currency_code'], 'contract_template_prices_set_idx');
    });
  }

  // Distribute only when every referenced table is distributed (they are local in
  // the repo today, so this is normally a no-op); distribute the parent set table
  // first, then the prices table, and add ALL foreign keys afterwards so they are
  // created between co-located tables.
  const parentsDistributed = (
    await Promise.all(
      ['contract_templates', 'contract_template_lines', 'contract_template_line_buckets'].map((t) =>
        distributionState(knex, t),
      ),
    )
  ).every((state) => state === true);
  if (parentsDistributed) {
    await distributeIfCitus(knex, 'contract_template_price_sets');
    await distributeIfCitus(knex, 'contract_template_prices');
  }

  await addConstraintIfMissing(knex, 'contract_template_price_sets', 'contract_template_price_sets_tenant_fk',
    'FOREIGN KEY (tenant) REFERENCES tenants (tenant)');
  await addConstraintIfMissing(knex, 'contract_template_price_sets', 'contract_template_price_sets_template_fk',
    'FOREIGN KEY (tenant, template_id) REFERENCES contract_templates (tenant, template_id) ON DELETE CASCADE');
  await addConstraintIfMissing(knex, 'contract_template_prices', 'contract_template_prices_tenant_fk',
    'FOREIGN KEY (tenant) REFERENCES tenants (tenant)');
  await addConstraintIfMissing(knex, 'contract_template_prices', 'contract_template_prices_set_fk',
    'FOREIGN KEY (tenant, template_id, currency_code) REFERENCES contract_template_price_sets (tenant, template_id, currency_code) ON DELETE CASCADE');
  await addConstraintIfMissing(knex, 'contract_template_prices', 'contract_template_prices_line_fk',
    'FOREIGN KEY (tenant, template_line_id) REFERENCES contract_template_lines (tenant, template_line_id) ON DELETE CASCADE');
  await addConstraintIfMissing(knex, 'contract_template_prices', 'contract_template_prices_bucket_fk',
    'FOREIGN KEY (tenant, bucket_id) REFERENCES contract_template_line_buckets (tenant, bucket_id) ON DELETE CASCADE');
  await addConstraintIfMissing(knex, 'contract_template_prices', 'contract_template_prices_rate_check',
    'CHECK (rate >= 0)');
  await addConstraintIfMissing(knex, 'contract_template_prices', 'contract_template_prices_slot_kind_check',
    `CHECK (slot_kind IN (${SLOT_KINDS.map((k) => `'${k}'`).join(', ')}))`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_template_prices');
  await knex.schema.dropTableIfExists('contract_template_price_sets');
  if (await knex.schema.hasColumn('contract_templates', 'currency_code')) {
    await knex.raw('ALTER TABLE contract_templates DROP COLUMN currency_code');
  }
};

// create_distributed_table must not run inside a transaction on Citus.
exports.config = { transaction: false };
