// Repair for quote-converted contracts (alga0002168).
//
// Quote conversion used to write the contract's lines `is_active = false` and the
// draft's client_contracts row `is_active = true`; nothing ever re-enabled the lines,
// so no service periods were materialized and the contract could not be invoiced.
// Conversion now writes lines active and a draft's assignment inactive (matching the
// contract wizard); this brings existing rows to the same shape.
//
// Citus-safe: every statement is tenant-scoped, ids are selected first, and the
// updates are plain parameterized `UPDATE ... WHERE tenant = ? AND id IN (...)`.
//
// Every inactive line of a quote-converted contract is re-enabled EXCEPT lines that show
// they were once live: any recurring_service_periods row for the line, or any invoice
// charge detail tied to the line (via its service configuration). Those can only exist if
// the line was activated through the API and later disabled on purpose, so they are left
// alone and logged by id for ops review. updated_at is NOT used as a signal: ordinary
// edits to a draft's lines (rates, configs, terms) bump it, and excluding those would
// leave exactly the affected contracts uninvoiceable.
//
// Periods for already-activated converted contracts are not materialized here; run
// "Fix all" (repairAllClientCadenceServicePeriodsForTenant) afterwards.
const MIGRATION_TENANT = 'migration:20261010040511_activate_quote_converted_contract_lines';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for quote-converted contract repair';
const CONVERSION_KIND_SQL = "ct.template_metadata->>'conversion_kind' = 'quote_to_contract'";
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

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);

    const lineQuery = db.table('contract_lines as cl');
    db.tenantJoin(lineQuery, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
    const lines = await lineQuery
      .whereRaw(CONVERSION_KIND_SQL)
      .where('cl.is_active', false)
      .select('cl.contract_line_id');
    const inactiveIds = lines.map((row) => row.contract_line_id);

    const everLive = new Set();
    for (const ids of chunk(inactiveIds)) {
      const periods = await db.table('recurring_service_periods')
        .whereIn('obligation_id', ids)
        .distinct('obligation_id');
      periods.forEach((row) => everLive.add(row.obligation_id));

      const chargeQuery = db.table('invoice_charge_details as icd');
      db.tenantJoin(chargeQuery, 'contract_line_service_configuration as c', 'c.config_id', 'icd.config_id');
      const charged = await chargeQuery
        .whereIn('c.contract_line_id', ids)
        .distinct('c.contract_line_id');
      charged.forEach((row) => everLive.add(row.contract_line_id));
    }
    const lineIds = inactiveIds.filter((id) => !everLive.has(id));
    const skippedIds = inactiveIds.filter((id) => everLive.has(id));
    const skipped = skippedIds.length;

    for (const ids of chunk(lineIds)) {
      await db.table('contract_lines')
        .whereIn('contract_line_id', ids)
        .update({ is_active: true });
    }

    const draftQuery = db.table('client_contracts as cc');
    db.tenantJoin(draftQuery, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
    const draftAssignments = await draftQuery
      .whereRaw(CONVERSION_KIND_SQL)
      .where('ct.status', 'draft')
      .where('cc.is_active', true)
      .select('cc.client_contract_id');
    const assignmentIds = draftAssignments.map((row) => row.client_contract_id);

    for (const ids of chunk(assignmentIds)) {
      await db.table('client_contracts')
        .whereIn('client_contract_id', ids)
        .update({ is_active: false });
    }

    if (lineIds.length || assignmentIds.length || skipped) {
      console.log(
        `[quote-converted repair] tenant=${tenant} linesActivated=${lineIds.length} ` +
          `linesSkippedPriorHistory=${skipped} skippedIds=[${skippedIds.join(',')}] draftAssignmentsDeactivated=${assignmentIds.length}`,
      );
    }
  }
};

exports.down = async function down() {
  // Data repair; the previous (broken) state is intentionally not restored.
};
