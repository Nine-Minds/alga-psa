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
 * Citus: tables are tenant-first, every UPDATE is parameterized per tenant with
 * tenant in the WHERE and no column function, and access goes through tenantDb.cjs.
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
  await knex.raw('ALTER TABLE contract_templates ALTER COLUMN currency_code SET NOT NULL');

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
      table.foreign('tenant').references('tenants.tenant');
      table
        .foreign(['tenant', 'template_id'])
        .references(['tenant', 'template_id'])
        .inTable('contract_templates')
        .onDelete('CASCADE');
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
      table.foreign('tenant').references('tenants.tenant');
      table
        .foreign(['tenant', 'template_id', 'currency_code'], 'contract_template_prices_set_fk')
        .references(['tenant', 'template_id', 'currency_code'])
        .inTable('contract_template_price_sets')
        .onDelete('CASCADE');
      table
        .foreign(['tenant', 'template_line_id'], 'contract_template_prices_line_fk')
        .references(['tenant', 'template_line_id'])
        .inTable('contract_template_lines')
        .onDelete('CASCADE');
      table
        .foreign(['tenant', 'bucket_id'], 'contract_template_prices_bucket_fk')
        .references(['tenant', 'bucket_id'])
        .inTable('contract_template_line_buckets')
        .onDelete('CASCADE');
    });
    await knex.raw(
      `ALTER TABLE contract_template_prices ADD CONSTRAINT contract_template_prices_rate_check CHECK (rate >= 0)`,
    );
    await knex.raw(
      `ALTER TABLE contract_template_prices ADD CONSTRAINT contract_template_prices_slot_kind_check CHECK (slot_kind IN (${SLOT_KINDS.map((k) => `'${k}'`).join(', ')}))`,
    );
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_template_prices');
  await knex.schema.dropTableIfExists('contract_template_price_sets');
  if (await knex.schema.hasColumn('contract_templates', 'currency_code')) {
    await knex.raw('ALTER TABLE contract_templates DROP COLUMN currency_code');
  }
};
