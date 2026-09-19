/**
 * Low-balance alerts for prepaid credit and bucket hours (task 29.8.20).
 *
 * Adds per-client alert policy columns to client_billing_settings and creates
 * the two durable, tenant-distributed ledgers that back the daily 09:00 UTC
 * scan:
 *
 *   - prepaid_balance_alerts        one logical alert per dedupe subject
 *   - prepaid_balance_alert_deliveries  leased delivery attempts per alert
 *
 * Also seeds the two email and two internal notification subtypes/templates
 * used by the delivery layer (through the shared template source of truth).
 *
 * Citus notes: transaction-free DDL, composite (tenant, *) keys, every table
 * distributed by tenant and colocated with tenants, and explicit names on
 * every CHECK constraint added outside CREATE TABLE (ADD COLUMN inline checks
 * are rejected by Citus).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const { upsertEmailCategoriesAndSubtypes } = require('./utils/templates/_shared/emailCategoriesAndSubtypes.cjs');
const { upsertEmailTemplates } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
const { upsertCategoriesAndSubtypes } = require('./utils/templates/internal/categoriesAndSubtypes.cjs');
const { upsertInternalTemplates } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');
const { getTemplate: getCreditEmailTemplate } = require('./utils/templates/email/billing/prepaidCreditLowBalance.cjs');
const { getTemplate: getBucketEmailTemplate } = require('./utils/templates/email/billing/prepaidBucketThresholdReached.cjs');
const { TEMPLATES: INTERNAL_TEMPLATES } = require('./utils/templates/internal/prepaidBalanceAlerts.cjs');

const HIGH_PRIORITY_INTERNAL_SUBTYPES = ['prepaid-credit-low-balance', 'prepaid-bucket-threshold-reached'];

async function addColumnWithNamedCheck(knex, table, column, columnSql, constraintSql) {
  await knex.raw('ALTER TABLE ?? ADD COLUMN IF NOT EXISTS ?? ' + columnSql, [table, column]);
  const constraintName = `${column}_ck`;
  const existing = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [constraintName, table]
  );
  if (existing.rows.length === 0) {
    await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' + constraintSql + ')', [table, constraintName]);
  }
}

async function dropNamedCheck(knex, table, column) {
  const constraintName = `${column}_ck`;
  const existing = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [constraintName, table]
  );
  if (existing.rows.length > 0) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [table, constraintName]);
  }
}

exports.up = async function up(knex) {
  // ---------------------------------------------------------------------------
  // 1. client_billing_settings: per-client alert policy (nullable, inert).
  // ---------------------------------------------------------------------------
  await addColumnWithNamedCheck(
    knex,
    'client_billing_settings',
    'prepaid_credit_alert_threshold',
    'bigint',
    'prepaid_credit_alert_threshold IS NULL OR prepaid_credit_alert_threshold > 0'
  );
  await addColumnWithNamedCheck(
    knex,
    'client_billing_settings',
    'prepaid_credit_alert_currency_code',
    'char(3)',
    "prepaid_credit_alert_currency_code IS NULL OR prepaid_credit_alert_currency_code ~ '^[A-Z]{3}$'"
  );
  await addColumnWithNamedCheck(
    knex,
    'client_billing_settings',
    'bucket_usage_alert_percent',
    'smallint',
    'bucket_usage_alert_percent IS NULL OR (bucket_usage_alert_percent BETWEEN 1 AND 100)'
  );
  await addColumnWithNamedCheck(
    knex,
    'client_billing_settings',
    'notify_client_on_prepaid_alert',
    'boolean NOT NULL DEFAULT false',
    'true'
  );

  // Amount and currency are either both present or both null.
  const pairingConstraint = 'prepaid_credit_alert_amount_currency_pairing_ck';
  const pairingExisting = await knex.raw(
    'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [pairingConstraint, 'client_billing_settings']
  );
  if (pairingExisting.rows.length === 0) {
    await knex.raw(
      'ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' +
        '(prepaid_credit_alert_threshold IS NULL) = (prepaid_credit_alert_currency_code IS NULL)' +
      ')',
      ['client_billing_settings', pairingConstraint]
    );
  }

  // ---------------------------------------------------------------------------
  // 2. prepaid_balance_alerts: one logical alert per dedupe subject.
  // ---------------------------------------------------------------------------
  const hasAlerts = await knex.schema.hasTable('prepaid_balance_alerts');
  if (!hasAlerts) {
    await knex.schema.createTable('prepaid_balance_alerts', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('alert_id').notNullable();
      table.uuid('client_id').notNullable();
      table.text('alert_type').notNullable();
      table.text('dedupe_key').notNullable();
      // Monotonically increasing below-threshold episode for credit subjects
      // (rearm + re-drop = next episode); bucket subjects always use episode 1.
      table.bigInteger('episode').notNullable().defaultTo(1);
      // Policy snapshot.
      table.bigInteger('credit_threshold').nullable();
      table.specificType('credit_currency_code', 'char(3)').nullable();
      table.smallint('bucket_percent').nullable();
      // Observed values.
      table.decimal('observed_value', 20, 2).nullable();
      table.decimal('observed_capacity', 20, 2).nullable();
      // Bucket subject snapshot.
      table.uuid('bucket_usage_id').nullable();
      table.uuid('service_catalog_id').nullable();
      table.uuid('contract_line_id').nullable();
      table.date('period_start').nullable();
      table.date('period_end').nullable();
      table.jsonb('payload').nullable();
      table.timestamp('triggered_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('resolved_at', { useTz: true }).nullable();
      table.text('resolution_reason').nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'alert_id']);
      table.unique(['tenant', 'dedupe_key'], 'prepaid_balance_alerts_tenant_dedupe_key_unique');
      table.foreign(['tenant', 'client_id'])
        .references(['tenant', 'client_id'])
        .inTable('clients');
      table.check("alert_type IN ('credit','bucket')", [], 'prepaid_balance_alerts_alert_type_check');
      table.check(
        "resolution_reason IS NULL OR resolution_reason IN ('recovered','policy_changed','client_deleted')",
        [],
        'prepaid_balance_alerts_resolution_reason_check'
      );
      table.index(['tenant', 'client_id', 'resolved_at'], 'prepaid_balance_alerts_open_client_idx');
      table.index(['tenant', 'alert_type', 'resolved_at'], 'prepaid_balance_alerts_type_state_idx');
    });

    await ensureTenantDistribution(knex, 'prepaid_balance_alerts');
  }

  // ---------------------------------------------------------------------------
  // 3. prepaid_balance_alert_deliveries: leased, idempotent delivery attempts.
  // ---------------------------------------------------------------------------
  const hasDeliveries = await knex.schema.hasTable('prepaid_balance_alert_deliveries');
  if (!hasDeliveries) {
    await knex.schema.createTable('prepaid_balance_alert_deliveries', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('delivery_id').notNullable();
      table.uuid('alert_id').notNullable();
      table.text('channel').notNullable();
      table.jsonb('recipient_roles').notNullable();
      table.text('recipient_key').notNullable();
      table.uuid('recipient_user_id').nullable();
      table.text('recipient_email').nullable();
      table.text('status').notNullable().defaultTo('pending');
      table.integer('attempt_count').notNullable().defaultTo(0);
      table.text('last_error').nullable();
      table.text('worker_id').nullable();
      table.timestamp('lease_expires_at', { useTz: true }).nullable();
      table.timestamp('sent_at', { useTz: true }).nullable();
      table.timestamp('skipped_at', { useTz: true }).nullable();
      table.timestamp('exhausted_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'delivery_id']);
      table.unique(
        ['tenant', 'alert_id', 'channel', 'recipient_key'],
        'prepaid_balance_alert_deliveries_identity_unique'
      );
      table.foreign(['tenant', 'alert_id'])
        .references(['tenant', 'alert_id'])
        .inTable('prepaid_balance_alerts');
      table.check("channel IN ('internal','email')", [], 'prepaid_balance_alert_deliveries_channel_check');
      table.check(
        "status IN ('pending','processing','sent','skipped','failed','exhausted','superseded')",
        [],
        'prepaid_balance_alert_deliveries_status_check'
      );
      table.index(['tenant', 'status', 'lease_expires_at'], 'prepaid_balance_alert_deliveries_claim_idx');
    });

    await ensureTenantDistribution(knex, 'prepaid_balance_alert_deliveries');
  }

  // Widen the status CHECK to accept the terminal 'superseded' state on
  // databases migrated before that state existed (the CREATE TABLE guard above
  // never runs for them). Idempotent: only replaced when the current definition
  // still lacks 'superseded'.
  const statusCheckName = 'prepaid_balance_alert_deliveries_status_check';
  const statusCheck = await knex.raw(
    'SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
    [statusCheckName, 'prepaid_balance_alert_deliveries']
  );
  if (statusCheck.rows.length === 1 && !String(statusCheck.rows[0].def).includes('superseded')) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', ['prepaid_balance_alert_deliveries', statusCheckName]);
    await knex.raw(
      'ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' +
        "status IN ('pending','processing','sent','skipped','failed','exhausted','superseded'))",
      ['prepaid_balance_alert_deliveries', statusCheckName]
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Notification subtypes/templates (shared source of truth).
  // ---------------------------------------------------------------------------
  await upsertEmailCategoriesAndSubtypes(knex);
  await upsertCategoriesAndSubtypes(knex);
  await upsertEmailTemplates(knex, [getCreditEmailTemplate(), getBucketEmailTemplate()]);
  await upsertInternalTemplates(knex, INTERNAL_TEMPLATES);

  // Internal alerts are high-priority warnings by default (29.8.46 priority
  // chain: user > tenant > subtype default > 'normal').
  await knex('internal_notification_subtypes')
    .whereIn('name', HIGH_PRIORITY_INTERNAL_SUBTYPES)
    .update({ default_priority: 'high', updated_at: knex.fn.now() });

  console.log('✓ Prepaid balance alerts migration applied');
};

exports.down = async function down(knex) {
  const { deleteEmailTemplate } = require('./utils/templates/_shared/upsertEmailTemplates.cjs');
  const { deleteInternalTemplate } = require('./utils/templates/_shared/upsertInternalTemplates.cjs');

  // Remove the seeded notification templates/subtypes (and categories when they
  // become empty), mirroring the project-billing notification migration.
  for (const name of ['prepaid-credit-low-balance', 'prepaid-bucket-threshold-reached']) {
    await deleteEmailTemplate(knex, name);
    await deleteInternalTemplate(knex, name);
  }
  await knex('notification_subtypes').whereIn('name', [
    'prepaid-credit-low-balance',
    'prepaid-bucket-threshold-reached',
  ]).del();
  await knex('internal_notification_subtypes').whereIn('name', [
    'prepaid-credit-low-balance',
    'prepaid-bucket-threshold-reached',
  ]).del();
  await knex('notification_categories').where({ name: 'Prepaid Alerts' }).whereNotExists(
    knex('notification_subtypes')
      .select(knex.raw('1'))
      .whereRaw('notification_subtypes.category_id = notification_categories.id')
  ).del();
  await knex('internal_notification_categories').where({ name: 'prepaid-alerts' }).whereNotExists(
    knex('internal_notification_subtypes')
      .select(knex.raw('1'))
      .whereRaw(
        'internal_notification_subtypes.internal_category_id = internal_notification_categories.internal_notification_category_id'
      )
  ).del();

  await knex.schema.dropTableIfExists('prepaid_balance_alert_deliveries');
  await knex.schema.dropTableIfExists('prepaid_balance_alerts');

  await dropNamedCheck(knex, 'client_billing_settings', 'prepaid_credit_alert_threshold');
  await dropNamedCheck(knex, 'client_billing_settings', 'prepaid_credit_alert_currency_code');
  await dropNamedCheck(knex, 'client_billing_settings', 'bucket_usage_alert_percent');
  await dropNamedCheck(knex, 'client_billing_settings', 'notify_client_on_prepaid_alert');
  await knex.raw(
    'ALTER TABLE client_billing_settings DROP CONSTRAINT IF EXISTS prepaid_credit_alert_amount_currency_pairing_ck'
  );
  await knex.schema.alterTable('client_billing_settings', (table) => {
    table.dropColumn('notify_client_on_prepaid_alert');
    table.dropColumn('bucket_usage_alert_percent');
    table.dropColumn('prepaid_credit_alert_currency_code');
    table.dropColumn('prepaid_credit_alert_threshold');
  });

  console.log('✓ Prepaid balance alerts migration reverted');
};

exports.config = { transaction: false };
