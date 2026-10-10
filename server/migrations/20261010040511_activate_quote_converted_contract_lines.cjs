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
// Lines whose updated_at differs from created_at are NOT touched. Conversion inserts
// lines with created_at = updated_at, but the API can still disable a contract line
// on purpose (ContractLineService unassign / setPlanActivation), and that is
// indistinguishable from the legacy state. Skipped lines are counted in the log.
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
      .select('cl.contract_line_id', 'cl.created_at', 'cl.updated_at');

    const sameInstant = (row) =>
      new Date(row.created_at).getTime() === new Date(row.updated_at).getTime();
    const lineIds = lines.filter(sameInstant).map((row) => row.contract_line_id);
    const skipped = lines.length - lineIds.length;

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
          `linesSkippedModified=${skipped} draftAssignmentsDeactivated=${assignmentIds.length}`,
      );
    }
  }
};

exports.down = async function down() {
  // Data repair; the previous (broken) state is intentionally not restored.
};
