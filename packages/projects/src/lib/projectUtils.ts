'use server'

import type { IProject, IProjectTask, ITimeEntry } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createProjectReadDecider } from './projectReadAuthorization';
import { isCoManagedReadFieldHidden } from '@alga-psa/co-managed/sharedWorkRedaction';
import { Knex } from 'knex';

export interface ProjectCompletionMetrics {
  taskCompletionPercentage: number;
  hoursCompletionPercentage: number | null;
  totalTasks: number;
  completedTasks: number;
  budgetedHours: number | null;
  spentHours: number;
  remainingHours: number | null;
}

/**
 * Calculate project completion metrics based on tasks and hours
 * @param projectId The project ID to calculate metrics for
 * @returns ProjectCompletionMetrics object with task and hours-based completion percentages
 */
export const calculateProjectCompletion = withAuth(async (
  user,
  { tenant },
  projectId: string
): Promise<ProjectCompletionMetrics> => {
  const { knex: db } = await createTenantKnex();
  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const scopedDb = tenantDb(trx, tenant);

    if (!await hasPermission(user, 'project', 'read', trx)) {
      throw new Error('Permission denied: Cannot read project');
    }

    // Load only the identity fields needed for the shared record decision. Metrics are not queried before
    // both coarse and record-level authorization succeeds.
    const project = await scopedDb.table('projects')
      .where({
        project_id: projectId,
      })
      .select('project_id', 'client_id', 'assigned_to')
      .first() as Pick<IProject, 'project_id' | 'client_id' | 'assigned_to'> | undefined;

    if (!project) {
      throw new Error(`Project with ID ${projectId} not found`);
    }

    const decideProjectRead = await createProjectReadDecider(trx, tenant, user);
    const decision = await decideProjectRead(project);
    if (!decision.allowed) {
      throw new Error('Permission denied: Cannot read project');
    }
    const budgetHidden = isCoManagedReadFieldHidden(decision.redactedFields, [
      'budgeted_hours', 'projects.budgeted_hours', 'fields.budgeted_hours',
    ]);
    const budgetRow = budgetHidden ? undefined : await scopedDb.table('projects')
      .where({ project_id: projectId })
      .select('budgeted_hours')
      .first<{ budgeted_hours: number | string | null }>();

    // Get all tasks for the project
    const tasksQuery = scopedDb.table<IProjectTask>('project_tasks');
    scopedDb.tenantJoin(tasksQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    scopedDb.tenantJoin(
      tasksQuery,
      'project_status_mappings',
      'project_tasks.project_status_mapping_id',
      'project_status_mappings.project_status_mapping_id',
      { type: 'left' }
    );
    scopedDb.tenantJoin(tasksQuery, 'statuses', 'project_status_mappings.status_id', 'statuses.status_id', { type: 'left' });
    const tasks = await tasksQuery
      .where('project_phases.project_id', projectId)
      .select(
        'project_tasks.*',
        'project_status_mappings.is_standard',
        'statuses.is_closed'
      );

    // Calculate task-based completion
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter(task => task.is_closed === true).length;
    const taskCompletionPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

    // Get time entries for the project
    const timeEntriesQuery = scopedDb.table<ITimeEntry>('time_entries');
    scopedDb.tenantJoin(timeEntriesQuery, 'project_tasks', 'time_entries.work_item_id', 'project_tasks.task_id', {
      on: (join) => {
        join.andOn('time_entries.work_item_type', '=', trx.raw("'project_task'"));
      },
    });
    scopedDb.tenantJoin(timeEntriesQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
    const timeEntries = await timeEntriesQuery
      .where('project_phases.project_id', projectId)
      .select('time_entries.billable_duration');

    // Calculate hours-based completion
    const budgetedHours = budgetHidden ? null : Number(budgetRow?.budgeted_hours || 0) / 60; // Convert minutes to hours
    // Convert billable_duration from minutes to hours
    const spentMinutes = timeEntries.reduce((total, entry) => total + entry.billable_duration, 0);
    const spentHours = spentMinutes / 60; // Convert minutes to hours for display
    const remainingHours = budgetedHours === null ? null : Math.max(0, budgetedHours - spentHours);
    const hoursCompletionPercentage = budgetedHours === null ? null : budgetedHours > 0 ? Math.min(100, (spentHours / budgetedHours) * 100) : 0;

    return {
      taskCompletionPercentage,
      hoursCompletionPercentage,
      totalTasks,
      completedTasks,
      budgetedHours,
      spentHours,
      remainingHours
    };
  });
});
