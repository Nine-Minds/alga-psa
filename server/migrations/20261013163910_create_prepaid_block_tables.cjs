/**
 * Prepaid Block contract line (alga-2026-0002695), part 1: new tables.
 *
 *   contract_line_prepaid_blocks            - block config overlay on an Hourly line (1:1)
 *   contract_line_block_issuances           - "a block is due on date X for line L" ledger
 *   contract_template_line_prepaid_blocks   - same config on template lines
 *   contract_line_preset_prepaid_blocks     - same config on line presets
 *
 * See docs/plans/2026-10-13-prepaid-block-invoicing-plan.md (D1, D2, D5).
 * Blocks themselves live in the existing hour_blocks ledger; the hour_blocks /
 * audit / alert changes are in the next migration.
 *
 * Citus: tenant-distributed, composite FKs on tenant, no RLS. Transaction-free
 * because FKs are added to distributed tables (see
 * 20260819150000_add_prepaid_auto_replenishment.cjs).
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

const TIERS = ['draft', 'auto_issue'];
const TRIGGER_KINDS = ['contract_start', 'exhaustion', 'threshold', 'expiry', 'renewal', 'manual'];
const ISSUANCE_STATUSES = ['scheduled', 'invoiced', 'superseded', 'cancelled'];

function inList(values) {
  return values.map((v) => `'${v}'`).join(', ');
}

async function addCheck(knex, table, name, expression) {
  const r = await knex.raw('SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass', [name, table]);
  if (r.rows.length === 0) {
    await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' + expression + ')', [table, name]);
  }
}

// Columns shared by the line, template-line and preset config tables.
function configColumns(table, knex) {
  table.integer('block_minutes').notNullable();
  // Minor units of the contract currency.
  table.bigInteger('block_price').notNullable();
  table.smallint('expiry_months').nullable();
  table.boolean('trigger_on_exhaustion').notNullable().defaultTo(true);
  table.smallint('trigger_threshold_percent').nullable();
  table.boolean('trigger_on_expiry').notNullable().defaultTo(false);
  table.boolean('trigger_on_renewal').notNullable().defaultTo(false);
  table.text('replenishment_tier').notNullable().defaultTo('draft');
  table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
}

async function addConfigChecks(knex, table) {
  await addCheck(knex, table, `${table}_block_minutes_ck`, 'block_minutes > 0');
  await addCheck(knex, table, `${table}_block_price_ck`, 'block_price >= 0');
  await addCheck(knex, table, `${table}_expiry_months_ck`, 'expiry_months IS NULL OR expiry_months BETWEEN 1 AND 120');
  await addCheck(
    knex,
    table,
    `${table}_threshold_ck`,
    'trigger_threshold_percent IS NULL OR trigger_threshold_percent BETWEEN 1 AND 99',
  );
  await addCheck(knex, table, `${table}_expiry_trigger_ck`, 'expiry_months IS NOT NULL OR trigger_on_expiry = false');
  await addCheck(knex, table, `${table}_tier_ck`, `replenishment_tier IN (${inList(TIERS)})`);
}

async function createConfigTable(knex, name, keyColumn, parentTable) {
  if (await knex.schema.hasTable(name)) return;
  await knex.schema.createTable(name, (table) => {
    table.uuid('tenant').notNullable();
    table.uuid(keyColumn).notNullable();
    // Required on lines; templates/presets may not have chosen a service yet.
    table.uuid('sold_as_service_id').nullable();
    configColumns(table, knex);

    table.primary(['tenant', keyColumn]);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', keyColumn]).references(['tenant', keyColumn]).inTable(parentTable).onDelete('CASCADE');
    table.foreign(['tenant', 'sold_as_service_id']).references(['tenant', 'service_id']).inTable('service_catalog');
  });
  await addConfigChecks(knex, name);
  await ensureTenantDistribution(knex, name);
}

exports.up = async function up(knex) {
  await createConfigTable(knex, 'contract_line_prepaid_blocks', 'contract_line_id', 'contract_lines');
  await createConfigTable(knex, 'contract_template_line_prepaid_blocks', 'template_line_id', 'contract_template_lines');
  await createConfigTable(knex, 'contract_line_preset_prepaid_blocks', 'preset_id', 'contract_line_presets');

  if (!(await knex.schema.hasTable('contract_line_block_issuances'))) {
    await knex.schema.createTable('contract_line_block_issuances', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('issuance_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('contract_line_id').notNullable();
      table.uuid('client_contract_id').notNullable();
      table.uuid('client_id').notNullable();
      table.text('trigger_kind').notNullable();
      table.date('due_date').notNullable();
      table.text('status').notNullable().defaultTo('scheduled');
      table.uuid('source_block_id').nullable();
      table.uuid('block_id').nullable();
      table.uuid('invoice_id').nullable();
      table.uuid('invoice_charge_id').nullable();
      table.uuid('alert_id').nullable();
      // Snapshot taken at invoicing.
      table.integer('block_minutes').nullable();
      table.bigInteger('block_price').nullable();
      table.specificType('currency_code', 'char(3)').nullable();
      table.text('cancel_reason').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'issuance_id']);
      table.foreign('tenant').references('tenants.tenant');
      table.foreign(['tenant', 'contract_line_id'])
        .references(['tenant', 'contract_line_id'])
        .inTable('contract_lines')
        .onDelete('CASCADE');
      table.foreign(['tenant', 'client_contract_id'])
        .references(['tenant', 'client_contract_id'])
        .inTable('client_contracts')
        .onDelete('CASCADE');
      table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('CASCADE');
    });
    await ensureTenantDistribution(knex, 'contract_line_block_issuances');
  }

  await addCheck(
    knex,
    'contract_line_block_issuances',
    'contract_line_block_issuances_trigger_kind_ck',
    `trigger_kind IN (${inList(TRIGGER_KINDS)})`,
  );
  await addCheck(
    knex,
    'contract_line_block_issuances',
    'contract_line_block_issuances_status_ck',
    `status IN (${inList(ISSUANCE_STATUSES)})`,
  );
  await addCheck(
    knex,
    'contract_line_block_issuances',
    'contract_line_block_issuances_block_minutes_ck',
    'block_minutes IS NULL OR block_minutes > 0',
  );

  // Soft references to rows owned by other tables: SET NULL on the column only
  // (tenant is part of the PK/distribution key and must not be nulled).
  const softFks = [
    ['source_block_id', 'hour_blocks', 'block_id', 'source_block'],
    ['block_id', 'hour_blocks', 'block_id', 'block'],
    ['invoice_id', 'invoices', 'invoice_id', 'invoice'],
    ['invoice_charge_id', 'invoice_charges', 'item_id', 'invoice_charge'],
    ['alert_id', 'prepaid_balance_alerts', 'alert_id', 'alert'],
  ];
  for (const [column, refTable, refColumn, label] of softFks) {
    const name = `contract_line_block_issuances_${label}_fkey`;
    await knex.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
          ALTER TABLE contract_line_block_issuances
            ADD CONSTRAINT ${name}
            FOREIGN KEY (tenant, ${column}) REFERENCES ${refTable}(tenant, ${refColumn})
            ON DELETE SET NULL (${column});
        END IF;
      END $$;
    `);
  }

  // Open-follow-on invariant: at most one scheduled issuance per line.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS contract_line_block_issuances_one_scheduled_uidx
    ON contract_line_block_issuances (tenant, contract_line_id)
    WHERE status = 'scheduled'
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS contract_line_block_issuances_due_idx
    ON contract_line_block_issuances (tenant, client_id, status, due_date)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS contract_line_block_issuances_invoice_idx
    ON contract_line_block_issuances (tenant, invoice_id)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_line_block_issuances');
  await knex.schema.dropTableIfExists('contract_line_preset_prepaid_blocks');
  await knex.schema.dropTableIfExists('contract_template_line_prepaid_blocks');
  await knex.schema.dropTableIfExists('contract_line_prepaid_blocks');
};
