const REPAIR_TENANT = 'migration:20260805130000_repair_renewal_clock_payload';
const ENUMERATION_REASON = 'enumerate tenants for renewal schedule clock payload repair';
const RENEWAL_KEY = 'system.opportunity.renewal-suggestions';

// Placeholder clock payload for the seeded renewal schedule row. Runtime
// synthesis re-derives the real clock payload at each fire and is the source of
// truth; this repair only replaces the pre-fix NULL/`{}` payload so the stored
// row no longer fails strict validation. The timestamps are a neutral "repair
// time" placeholder (not a reconstruction of a stale fire), which is why the
// plan forbids inventing historical timestamps here.
function buildClockPlaceholderPayload(schedule, now) {
  return {
    triggerType: 'recurring',
    scheduleId: schedule.id,
    scheduledFor: now,
    firedAt: now,
    timezone: schedule.timezone || 'UTC',
    workflowId: schedule.workflow_id,
    workflowVersion: schedule.workflow_version,
    ...(schedule.cron ? { cron: schedule.cron } : {}),
  };
}

exports.up = async function up(knex) {
  const { tenantDb } = require('./utils/tenantDb.cjs');
  const migrationDb = tenantDb(knex, REPAIR_TENANT);
  const tenants = await migrationDb.unscoped('tenants', ENUMERATION_REASON)
    .select('tenant');
  const now = new Date().toISOString();

  for (const row of tenants) {
    const db = tenantDb(knex, row.tenant);
    const workflow = await db.table('workflow_definitions')
      .where({ key: RENEWAL_KEY })
      .select('workflow_id')
      .first();
    if (!workflow) continue;

    // Narrowly targeted at the seeded renewal schedule row only; never touches
    // unrelated schedules for the workflow or other tenants.
    const schedule = await db.table('tenant_workflow_schedule')
      .where({ workflow_id: workflow.workflow_id, name: RENEWAL_KEY })
      .first();
    if (!schedule) continue;

    await db.table('tenant_workflow_schedule')
      .where({ id: schedule.id })
      .update({
        payload_json: buildClockPlaceholderPayload(schedule, now),
        // Drop the failed-validation residue from pre-fix fires; the next fire
        // re-derives everything.
        last_error: null,
        last_run_status: null,
        updated_at: now,
      });
  }
};

exports.down = async function down() {
  // No-op: reverting the payload to NULL/`{}` would re-break the cleared
  // schedules. The repair is forward-only and idempotent.
};