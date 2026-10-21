// Data repair for alga-2026-0002697: Hourly and Usage contract lines can never bill In Advance.
//
// Advance on an Hourly/Usage line claims a period as billed before the work exists, so time
// logged afterwards is never billed. The authoring paths and the engine now force arrears;
// this brings stored data to the same shape. The CHECK constraints are a separate, later
// migration (data and DDL are kept apart for Citus).
//
// Per tenant:
//   1. contract_lines, contract_template_lines and contract_line_presets with an Hourly/Usage
//      type and billing_timing = 'advance' are set to 'arrears'.
//   2. Unbilled generated/locked advance recurring_service_periods rows of those live lines
//      (no invoice, no charge detail) are superseded with reason hourly_usage_arrears_repair.
//   3. Edited/skipped advance rows and billed advance rows are NOT touched here; they are
//      logged by count for the repair action (repairAllRecurringServicePeriodsForTenant),
//      which re-homes edited rows and adds the arrears catch-up rows for stranded periods.
//
// Citus-safe: every statement is tenant-scoped, ids are selected first, values are bound in
// Node, and there are no functions or casts on columns in the UPDATEs.
const MIGRATION_TENANT = 'migration:20261013120000_hourly_usage_lines_bill_in_arrears';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for hourly/usage arrears-only repair';
const NON_FIXED_TYPES = ['Hourly', 'Usage'];
const REPAIR_REASON = 'hourly_usage_arrears_repair';
const CHUNK = 500;

exports.config = { transaction: true };

function chunk(items) {
  const out = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

exports.up = async function up(knex) {
  const { tenantDb } = require('./utils/tenantDb.cjs');
  const tenants = await tenantDb(knex, MIGRATION_TENANT)
    .unscoped('tenants', TENANT_ENUMERATION_REASON)
    .select('tenant');
  const nowIso = new Date().toISOString();

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);

    const lines = await db.table('contract_lines')
      .whereIn('contract_line_type', NON_FIXED_TYPES)
      .where('billing_timing', 'advance')
      .select('contract_line_id');
    const lineIds = lines.map((row) => row.contract_line_id);
    for (const ids of chunk(lineIds)) {
      await db.table('contract_lines').whereIn('contract_line_id', ids).update({ billing_timing: 'arrears' });
    }

    const templateLines = await db.table('contract_template_lines')
      .whereIn('line_type', NON_FIXED_TYPES)
      .where('billing_timing', 'advance')
      .select('template_line_id');
    for (const ids of chunk(templateLines.map((row) => row.template_line_id))) {
      await db.table('contract_template_lines').whereIn('template_line_id', ids).update({ billing_timing: 'arrears' });
    }

    const presets = await db.table('contract_line_presets')
      .whereIn('contract_line_type', NON_FIXED_TYPES)
      .where('billing_timing', 'advance')
      .select('preset_id');
    for (const ids of chunk(presets.map((row) => row.preset_id))) {
      await db.table('contract_line_presets').whereIn('preset_id', ids).update({ billing_timing: 'arrears' });
    }

    let superseded = 0;
    const heldIds = [];
    let billedLineIds = new Set();
    for (const ids of chunk(lineIds)) {
      const rows = await db.table('recurring_service_periods')
        .whereIn('obligation_id', ids)
        .where('due_position', 'advance')
        .whereNotIn('lifecycle_state', ['superseded', 'archived'])
        .select('record_id', 'obligation_id', 'lifecycle_state', 'invoice_id', 'invoice_charge_detail_id');
      const unbilled = rows
        .filter((row) => !row.invoice_id && !row.invoice_charge_detail_id
          && (row.lifecycle_state === 'generated' || row.lifecycle_state === 'locked'))
        .map((row) => row.record_id);
      for (const batch of chunk(unbilled)) {
        await db.table('recurring_service_periods')
          .whereIn('record_id', batch)
          .whereNull('invoice_id')
          .whereNull('invoice_charge_detail_id')
          .update({ lifecycle_state: 'superseded', reason_code: REPAIR_REASON, updated_at: nowIso });
      }
      superseded += unbilled.length;
      rows.filter((row) => row.lifecycle_state === 'edited' || row.lifecycle_state === 'skipped')
        .forEach((row) => heldIds.push(row.record_id));
      rows.filter((row) => row.invoice_id).forEach((row) => billedLineIds.add(row.obligation_id));
    }

    if (lineIds.length || templateLines.length || presets.length) {
      console.log(
        `[hourly_usage_lines_bill_in_arrears] tenant=${tenant} lines=${lineIds.length} `
        + `templateLines=${templateLines.length} presets=${presets.length} supersededRows=${superseded} `
        + `linesWithBilledAdvanceRows=${billedLineIds.size} editedOrSkippedAdvanceRows=${heldIds.length}`
        + (heldIds.length ? ` editedIds=${heldIds.join(',')}` : ''),
      );
    }
  }
};

exports.down = async function down() {
  // Data repair; the previous (invalid) advance timing is not restored.
};
