/**
 * The DB-polling workflow execution engine was removed; Temporal is the only
 * engine. Runs that were created for the DB engine (engine = 'db' or null)
 * and never reached a terminal state have nothing left to execute them, so
 * finalize them as CANCELED and resolve their open waits. Terminal rows are
 * left untouched as history.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const strandedRuns = await knex('workflow_runs')
    .where(function () {
      this.whereNull('engine').orWhere('engine', '!=', 'temporal');
    })
    .whereIn('status', ['RUNNING', 'WAITING'])
    .select('run_id');

  if (strandedRuns.length === 0) {
    return;
  }

  const runIds = strandedRuns.map((run) => run.run_id);
  const now = new Date().toISOString();

  await knex('workflow_runs')
    .whereIn('run_id', runIds)
    .update({
      status: 'CANCELED',
      completed_at: now,
      error_json: JSON.stringify({
        message: 'Canceled: the DB workflow execution engine was removed in the temporal-only cutover; this run had no engine left to execute it.',
        stage: 'migration',
        migration: '20260609120000_cancel_stranded_db_engine_workflow_runs',
      }),
    });

  await knex('workflow_run_waits')
    .whereIn('run_id', runIds)
    .where('status', 'WAITING')
    .update({
      status: 'CANCELED',
      resolved_at: now,
    });
};

/**
 * Irreversible: the previous RUNNING/WAITING states are not preserved. The
 * runs stay CANCELED with the migration note in error_json.
 *
 * @param { import("knex").Knex } knex
 */
exports.down = async function () {};
