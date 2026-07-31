
/**
 * Recompute persisted project-task actual minutes from linked entry timestamps.
 * Approval state and billable duration intentionally do not participate.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  const rows = await knex('project_tasks as task')
    .leftJoin('time_entries as entry', function joinTimeEntries() {
      this.on('entry.tenant', '=', 'task.tenant')
        .andOn('entry.work_item_id', '=', 'task.task_id')
        .andOn('entry.work_item_type', '=', knex.raw('?', ['project_task']));
    })
    .groupBy('task.tenant', 'task.task_id')
    .select(
      'task.tenant',
      'task.task_id',
      knex.raw(`
        COALESCE(
          SUM(GREATEST(ROUND(EXTRACT(EPOCH FROM (entry.end_time - entry.start_time)) / 60.0), 0)),
          0
        )::bigint AS actual_minutes
      `),
    );

  // Citus forbids distributed UPDATE expressions that read other columns. Read
  // first, then write parameterized literals with the tenant shard key.
  for (const row of rows) {
    await knex('project_tasks')
      .where({ tenant: row.tenant, task_id: row.task_id })
      .update({ actual_hours: String(row.actual_minutes) });
  }
};

/**
 * This is a data repair. Rolling it back must not restore stale manual values.
 *
 * @returns {Promise<void>}
 */
exports.down = async function down() {};
