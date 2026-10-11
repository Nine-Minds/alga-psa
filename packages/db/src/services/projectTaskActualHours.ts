import type { Knex } from 'knex';
import { tenantDb } from '../lib/tenantDb';
import { withTransaction } from '../lib/tenant';

export interface ProjectTaskTimeEntryRef {
  work_item_id?: string | null;
  work_item_type?: string | null;
}

export async function recalculateProjectTaskActualHours(
  connection: Knex | Knex.Transaction,
  tenant: string,
  taskIds: Iterable<string | null | undefined>,
): Promise<void> {
  const uniqueTaskIds = [...new Set([...taskIds].filter((taskId): taskId is string => Boolean(taskId)))].sort();
  if (uniqueTaskIds.length === 0) return;

  await withTransaction(connection, async trx => {
    const scoped = tenantDb(trx, tenant);
    // Serialize before taking the aggregate snapshot. Locking only on the final
    // UPDATE lets concurrent entries overwrite the total with a stale sum.
    await scoped.table('project_tasks').whereIn('task_id', uniqueTaskIds).orderBy('task_id').forUpdate().select('task_id');
    await updateActualMinutes(trx, tenant, uniqueTaskIds);
  });
}

async function updateActualMinutes(connection: Knex.Transaction, tenant: string, uniqueTaskIds: string[]) {
  const db = tenantDb(connection, tenant);
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
