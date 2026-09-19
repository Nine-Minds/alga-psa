/**
 * Auto-replenishment policy for the existing prepaid balance alert episodes.
 *
 * The alert row remains the dedupe/pending state machine: a draft or issued
 * replenishment is linked to the episode that caused it, so a daily scan can
 * never create a second invoice for the same below-threshold episode.
 *
 * Citus requirements: this migration is transaction-free because it adds a
 * composite FK to a distributed table. No RLS is enabled.
 */

exports.config = { transaction: false };

const REPLENISHMENT_TIERS = ['notify', 'draft', 'auto_issue'];
const REPLENISHMENT_STATES = ['pending', 'issued', 'skipped', 'failed'];

async function addColumn(knex, table, column, sql) {
  await knex.raw('ALTER TABLE ?? ADD COLUMN IF NOT EXISTS ?? ' + sql, [table, column]);
}

async function addCheck(knex, table, name, expression) {
  const result = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [name, table],
  );
  if (result.rows.length === 0) {
    await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' + expression + ')', [table, name]);
  }
}

async function dropConstraint(knex, table, name) {
  const result = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [name, table],
  );
  if (result.rows.length > 0) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [table, name]);
  }
}

exports.up = async function up(knex) {
  await addColumn(knex, 'client_billing_settings', 'prepaid_replenishment_tier', "text NOT NULL DEFAULT 'draft'");
  await addColumn(knex, 'client_billing_settings', 'prepaid_credit_replenishment_amount', 'bigint NULL');
  await addColumn(knex, 'client_billing_settings', 'prepaid_bucket_replenishment_minutes', 'bigint NULL');
  await addColumn(knex, 'client_billing_settings', 'prepaid_replenishment_horizon_days', 'smallint NOT NULL DEFAULT 30');
  await addCheck(
    knex,
    'client_billing_settings',
    'client_billing_settings_prepaid_replenishment_tier_ck',
    `prepaid_replenishment_tier IN (${REPLENISHMENT_TIERS.map((value) => `'${value}'`).join(', ')})`,
  );
  await addCheck(
    knex,
    'client_billing_settings',
    'client_billing_settings_prepaid_credit_replenishment_amount_ck',
    'prepaid_credit_replenishment_amount IS NULL OR prepaid_credit_replenishment_amount > 0',
  );
  await addCheck(
    knex,
    'client_billing_settings',
    'client_billing_settings_prepaid_bucket_replenishment_minutes_ck',
    'prepaid_bucket_replenishment_minutes IS NULL OR prepaid_bucket_replenishment_minutes > 0',
  );
  await addCheck(
    knex,
    'client_billing_settings',
    'client_billing_settings_prepaid_replenishment_horizon_days_ck',
    'prepaid_replenishment_horizon_days BETWEEN 0 AND 3650',
  );

  await addColumn(knex, 'prepaid_balance_alerts', 'replenishment_status', 'text NULL');
  await addColumn(knex, 'prepaid_balance_alerts', 'replenishment_invoice_id', 'uuid NULL');
  await addColumn(knex, 'prepaid_balance_alerts', 'replenishment_credit_amount', 'bigint NULL');
  await addColumn(knex, 'prepaid_balance_alerts', 'replenishment_bucket_minutes', 'bigint NULL');
  await addColumn(knex, 'prepaid_balance_alerts', 'replenishment_attempted_at', 'timestamptz NULL');
  await addColumn(knex, 'prepaid_balance_alerts', 'replenishment_error', 'text NULL');
  await addCheck(
    knex,
    'prepaid_balance_alerts',
    'prepaid_balance_alerts_replenishment_status_ck',
    `replenishment_status IS NULL OR replenishment_status IN (${REPLENISHMENT_STATES.map((value) => `'${value}'`).join(', ')})`,
  );

  // Both tables are already distributed by tenant and invoices are the
  // colocation anchor. Add the composite FK only after the columns exist.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'prepaid_balance_alerts_replenishment_invoice_fkey'
      ) THEN
        ALTER TABLE prepaid_balance_alerts
          ADD CONSTRAINT prepaid_balance_alerts_replenishment_invoice_fkey
          FOREIGN KEY (tenant, replenishment_invoice_id)
          REFERENCES invoices(tenant, invoice_id);
      END IF;
    END $$;
  `);
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS prepaid_balance_alerts_replenishment_state_idx ON prepaid_balance_alerts (tenant, replenishment_status, resolved_at)',
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS prepaid_balance_alerts_replenishment_state_idx');
  await dropConstraint(knex, 'prepaid_balance_alerts', 'prepaid_balance_alerts_replenishment_invoice_fkey');
  await dropConstraint(knex, 'prepaid_balance_alerts', 'prepaid_balance_alerts_replenishment_status_ck');
  for (const column of [
    'replenishment_error',
    'replenishment_attempted_at',
    'replenishment_bucket_minutes',
    'replenishment_credit_amount',
    'replenishment_invoice_id',
    'replenishment_status',
  ]) {
    await knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ??', ['prepaid_balance_alerts', column]);
  }

  for (const name of [
    'client_billing_settings_prepaid_replenishment_horizon_days_ck',
    'client_billing_settings_prepaid_bucket_replenishment_minutes_ck',
    'client_billing_settings_prepaid_credit_replenishment_amount_ck',
    'client_billing_settings_prepaid_replenishment_tier_ck',
  ]) {
    await dropConstraint(knex, 'client_billing_settings', name);
  }
  for (const column of [
    'prepaid_replenishment_horizon_days',
    'prepaid_bucket_replenishment_minutes',
    'prepaid_credit_replenishment_amount',
    'prepaid_replenishment_tier',
  ]) {
    await knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ??', ['client_billing_settings', column]);
  }
};
