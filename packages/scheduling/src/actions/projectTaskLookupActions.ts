'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
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

export const getSchedulingProjectTaskById = withAuth(async (
  _user,
  { tenant },
  taskId: string
): Promise<SchedulingProjectTaskDetailsRecord | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const task = await trx('project_tasks as pt')
      .leftJoin('project_phases as pp', function joinPhases() {
        this.on('pt.phase_id', '=', 'pp.phase_id')
          .andOn('pt.tenant', '=', 'pp.tenant');
      })
      .leftJoin('projects as p', function joinProjects() {
        this.on('pp.project_id', '=', 'p.project_id')
          .andOn('pp.tenant', '=', 'p.tenant');
      })
      .leftJoin('project_status_mappings as psm', function joinStatuses() {
        this.on('pt.project_status_mapping_id', '=', 'psm.project_status_mapping_id')
          .andOn('pt.tenant', '=', 'psm.tenant');
      })
      .leftJoin('users as u', function joinUsers() {
        this.on('pt.assigned_to', '=', 'u.user_id')
          .andOn('pt.tenant', '=', 'u.tenant');
      })
      .where({
        'pt.task_id': taskId,
        'pt.tenant': tenant,
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
      )
      .first();

    if (!task) {
      return null;
    }

    const checklistItems = await trx('task_checklist_items')
      .where({
        task_id: taskId,
        tenant,
      })
      .select('checklist_item_id', 'item_name', 'completed')
      .orderBy('created_at', 'asc');

    return {
      ...(task as Omit<SchedulingProjectTaskDetailsRecord, 'checklist_items'>),
      checklist_items: checklistItems as SchedulingProjectTaskDetailsRecord['checklist_items'],
    };
  });
});
