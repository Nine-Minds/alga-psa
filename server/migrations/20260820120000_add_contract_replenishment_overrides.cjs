/**
 * Contract-scoped prepaid replenishment overrides and bounded retry state.
 * Null override columns mean inherit the client billing policy. This is a
 * forward-only additive migration; the preceding task migration remains
 * unchanged for upgrade safety.
 */

exports.config = { transaction: false };

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

exports.up = async function up(knex) {
  await addColumn(knex, 'client_contracts', 'prepaid_replenishment_tier', 'text NULL');
  await addColumn(knex, 'client_contracts', 'prepaid_credit_replenishment_amount', 'bigint NULL');
  await addColumn(knex, 'client_contracts', 'prepaid_bucket_replenishment_minutes', 'bigint NULL');
  await addColumn(knex, 'client_contracts', 'prepaid_replenishment_horizon_days', 'smallint NULL');
  await addCheck(
    knex,
    'client_contracts',
    'client_contracts_prepaid_replenishment_tier_ck',
    "prepaid_replenishment_tier IS NULL OR prepaid_replenishment_tier IN ('notify', 'draft', 'auto_issue')",
  );
  await addCheck(
    knex,
    'client_contracts',
    'client_contracts_prepaid_credit_replenishment_amount_ck',
    'prepaid_credit_replenishment_amount IS NULL OR prepaid_credit_replenishment_amount > 0',
  );
  await addCheck(
    knex,
    'client_contracts',
    'client_contracts_prepaid_bucket_replenishment_minutes_ck',
    'prepaid_bucket_replenishment_minutes IS NULL OR prepaid_bucket_replenishment_minutes > 0',
  );
  await addCheck(
    knex,
    'client_contracts',
    'client_contracts_prepaid_replenishment_horizon_days_ck',
    'prepaid_replenishment_horizon_days IS NULL OR prepaid_replenishment_horizon_days BETWEEN 0 AND 3650',
  );

  await addColumn(knex, 'prepaid_balance_alerts', 'replenishment_attempt_count', 'integer NOT NULL DEFAULT 0');
  await addCheck(
    knex,
    'prepaid_balance_alerts',
    'prepaid_balance_alerts_replenishment_attempt_count_ck',
    'replenishment_attempt_count >= 0',
  );
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [
    'prepaid_balance_alerts',
    'prepaid_balance_alerts_replenishment_attempt_count_ck',
  ]);
  await knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ??', ['prepaid_balance_alerts', 'replenishment_attempt_count']);
  for (const name of [
    'client_contracts_prepaid_replenishment_horizon_days_ck',
    'client_contracts_prepaid_bucket_replenishment_minutes_ck',
    'client_contracts_prepaid_credit_replenishment_amount_ck',
    'client_contracts_prepaid_replenishment_tier_ck',
  ]) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', ['client_contracts', name]);
  }
  for (const column of [
    'prepaid_replenishment_horizon_days',
    'prepaid_bucket_replenishment_minutes',
    'prepaid_credit_replenishment_amount',
    'prepaid_replenishment_tier',
  ]) {
    await knex.raw('ALTER TABLE ?? DROP COLUMN IF EXISTS ??', ['client_contracts', column]);
  }
};
