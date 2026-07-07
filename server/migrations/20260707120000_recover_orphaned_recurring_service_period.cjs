'use strict';

/**
 * Surgical recovery for recurring_service_periods obligations that were left
 * "superseded but not replaced" -- i.e. their latest revision is `superseded`,
 * nothing was ever billed for that period, yet the invoice window has already
 * opened. Because the invoice generator excludes `superseded`/`archived` rows,
 * such a period silently drops out of billing (an orphan): the approved work in
 * that service period can never be invoiced even though the obligation is valid.
 *
 * This happens when a schedule regeneration / repair run supersedes the current
 * open period without materializing a `generated` successor for it (see the
 * positional-merge / coverage-anchor behaviour in
 * shared/billingClients/regenerateRecurringServicePeriods.ts). The forward fix
 * for the *mechanism* is tracked separately; this migration only repairs data
 * that is already stranded.
 *
 * Recovery mints a fresh `generated` successor at revision = max(revision)+1 for
 * the affected (schedule_key, period_key), pointing `supersedes_record_id` at the
 * orphaned row. This is exactly the row shape the engine itself produces when it
 * regenerates over a superseded ledger, so downstream materialization/invoicing
 * treats it as a normal open period.
 *
 * Scope: intentionally limited to the Nine Minds tenant's orphaned periods (the
 * "AI Med Consult" June obligation and any sibling in the same tenant matching
 * the same orphan signature). It is idempotent -- it only acts where a genuine
 * orphan exists with no active (`generated`/`billed`) or invoiced sibling, so a
 * re-run, or a run in an environment without the orphan, is a no-op.
 */

const TENANT = '55f6a1b8-8ad9-42c7-ba39-a508dcaecd37';
const RECOVERY_RUN_KEY_PREFIX = 'orphan-recovery:20260707120000';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('recurring_service_periods');
  if (!hasTable) {
    console.log('recurring_service_periods table missing - skipping orphan recovery');
    return;
  }

  const result = await knex.raw(
    `
    WITH orphan AS (
      SELECT s.*
      FROM recurring_service_periods s
      WHERE s.tenant = ?
        AND s.lifecycle_state = 'superseded'
        AND s.invoice_id IS NULL
        AND s.invoice_window_start <= now()
        -- only the newest revision of the period, so we chain from the true tail
        AND s.revision = (
          SELECT max(x.revision)
          FROM recurring_service_periods x
          WHERE x.tenant = s.tenant
            AND x.schedule_key = s.schedule_key
            AND x.period_key = s.period_key
        )
        -- genuinely orphaned: no active or billed/invoiced sibling exists
        AND NOT EXISTS (
          SELECT 1
          FROM recurring_service_periods a
          WHERE a.tenant = s.tenant
            AND a.schedule_key = s.schedule_key
            AND a.period_key = s.period_key
            AND (a.lifecycle_state IN ('generated', 'billed') OR a.invoice_id IS NOT NULL)
        )
    )
    INSERT INTO recurring_service_periods (
      tenant, record_id, schedule_key, period_key, revision,
      obligation_id, obligation_type, charge_family, cadence_owner, due_position,
      lifecycle_state, service_period_start, service_period_end,
      invoice_window_start, invoice_window_end, activity_window_start, activity_window_end,
      timing_metadata, provenance_kind, source_rule_version, reason_code, source_run_key,
      supersedes_record_id, invoice_id, invoice_charge_id, invoice_charge_detail_id, invoice_linked_at,
      created_at, updated_at
    )
    SELECT
      o.tenant,
      o.schedule_key || ':' || o.period_key || ':r' || (o.revision + 1),
      o.schedule_key, o.period_key, o.revision + 1,
      o.obligation_id, o.obligation_type, o.charge_family, o.cadence_owner, o.due_position,
      'generated', o.service_period_start, o.service_period_end,
      o.invoice_window_start, o.invoice_window_end, o.activity_window_start, o.activity_window_end,
      o.timing_metadata, 'regenerated', o.source_rule_version, 'backfill_materialization',
      ? || ':' || o.schedule_key,
      o.record_id, NULL, NULL, NULL, NULL,
      now(), now()
    FROM orphan o
    `,
    [TENANT, RECOVERY_RUN_KEY_PREFIX],
  );

  const inserted = result.rowCount ?? 0;
  console.log(`Recovered ${inserted} orphaned recurring_service_period(s) for tenant ${TENANT}`);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('recurring_service_periods');
  if (!hasTable) {
    return;
  }

  // Remove only the rows this migration created (identified by run-key prefix and
  // never invoiced), and only while they remain plain generated recoveries.
  await knex('recurring_service_periods')
    .where('tenant', TENANT)
    .andWhere('lifecycle_state', 'generated')
    .andWhere('provenance_kind', 'regenerated')
    .whereNull('invoice_id')
    .andWhere('source_run_key', 'like', `${RECOVERY_RUN_KEY_PREFIX}:%`)
    .del();
};
