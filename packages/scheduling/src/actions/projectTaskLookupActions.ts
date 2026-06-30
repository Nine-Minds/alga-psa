'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface SchedulingProjectTaskDetailsRecord {
  task_id: string;
  task_name: string | null;
  task_description: string | null;
  phase_id: string | null;
  phase_name: string | null;
  project_id: string | null;
  project_name: string | null;
  project_status_mapping_id: string | null;
  status_id: string | null;
  due_date: Date | string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  checklist_items: Array<{
    checklist_item_id: string;
    item_name: string | null;
    completed: boolean;
  }>;
}

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export const getSchedulingProjectTaskById = withAuth(async (
  _user,
  { tenant },
  taskId: string
): Promise<SchedulingProjectTaskDetailsRecord | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const tenantFacade = tenantDb(trx, tenant);
    const taskQuery = tenantScopedTable(trx, 'project_tasks as pt', tenant)
      .where({
        'pt.task_id': taskId,
      })
      .select(
        'pt.task_id',
        'pt.task_name',
        'pt.description as task_description',
        'pt.phase_id',
        'pt.project_status_mapping_id',
        'pt.due_date',
        'pt.assigned_to',
        'pp.phase_name',
        'pp.project_id',
        'p.project_name',
        'psm.status_id',
        trx.raw(`CASE WHEN u.first_name IS NOT NULL OR u.last_name IS NOT NULL
          THEN TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')))
          ELSE u.username END as assigned_to_name`)
      );
    tenantFacade.tenantJoin(taskQuery, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id', { type: 'left' });
    tenantFacade.tenantJoin(taskQuery, 'projects as p', 'pp.project_id', 'p.project_id', { type: 'left' });
    tenantFacade.tenantJoin(taskQuery, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id', { type: 'left' });
    tenantFacade.tenantJoin(taskQuery, 'users as u', 'pt.assigned_to', 'u.user_id', { type: 'left' });
    const task = await taskQuery.first();

    if (!task) {
      return null;
    }

    const checklistItems = await tenantScopedTable(trx, 'task_checklist_items', tenant)
      .where({
        task_id: taskId,
      })
      .select('checklist_item_id', 'item_name', 'completed')
      .orderBy('created_at', 'asc');

    return {
      ...(task as Omit<SchedulingProjectTaskDetailsRecord, 'checklist_items'>),
      checklist_items: checklistItems as SchedulingProjectTaskDetailsRecord['checklist_items'],
    };
  });
});
