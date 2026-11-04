import type { Knex } from 'knex';
import { tenantDb } from '../lib/tenantDb';

export interface ProjectTaskTimeEntryRef {
  work_item_id?: string | null;
  work_item_type?: string | null;
}

export async function recalculateProjectTaskActualHours(
  connection: Knex | Knex.Transaction,
  tenant: string,
  taskIds: Iterable<string | null | undefined>,
): Promise<void> {
  // Sorted so concurrent recomputes that touch overlapping task sets lock rows in the
  // same order and cannot deadlock each other.
  const uniqueTaskIds = [...new Set([...taskIds].filter((taskId): taskId is string => Boolean(taskId)))].sort();
  if (uniqueTaskIds.length === 0) return;

  const db = tenantDb(connection, tenant);

  // Serialise per task: lock the task rows (on the caller's transaction) BEFORE reading the
  // time_entries total. A second writer blocks here until the first commits, then its SUM
  // (READ COMMITTED) sees the first writer's entry. Without the lock both read the
  // pre-commit total and the last UPDATE silently loses the other entry.
  // ORDER BY task_id makes the lock acquisition order deterministic across statements.
  await db.table('project_tasks')
    .whereIn('task_id', uniqueTaskIds)
    .orderBy('task_id', 'asc')
    .forUpdate()
    .select('task_id');

  const totals = await db.table('time_entries')
    .where({ work_item_type: 'project_task' })
    .whereIn('work_item_id', uniqueTaskIds)
    .groupBy('work_item_id')
    .select(
      'work_item_id',
      connection.raw(`
        COALESCE(
          SUM(GREATEST(ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60.0), 0)),
          0
        )::bigint AS actual_minutes
      `),
    ) as Array<{ work_item_id: string; actual_minutes: string | number }>;
  const totalsByTaskId = new Map(
    totals.map((row) => [row.work_item_id, Number(row.actual_minutes) || 0]),
  );
  const updatedAt = new Date().toISOString();

  for (const taskId of uniqueTaskIds) {
    await db.table('project_tasks')
      .where({ task_id: taskId })
      .update({
        actual_hours: totalsByTaskId.get(taskId) ?? 0,
        updated_at: updatedAt,
      });
  }
}

export async function recalculateProjectTaskActualHoursForEntryChange(
  connection: Knex | Knex.Transaction,
  tenant: string,
  before: ProjectTaskTimeEntryRef | null | undefined,
  after: ProjectTaskTimeEntryRef | null | undefined,
): Promise<void> {
  const taskIds = [before, after]
    .filter((entry): entry is ProjectTaskTimeEntryRef => entry?.work_item_type === 'project_task')
    .map((entry) => entry.work_item_id);
  await recalculateProjectTaskActualHours(connection, tenant, taskIds);
}
