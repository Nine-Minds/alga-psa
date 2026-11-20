'use server'

import type { IProject, IProjectTask, ITimeEntry } from '@alga-psa/types';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import { isResolverGovernedUser } from '@alga-psa/authorization/recordCreateAuthorization';
import type { IUserWithRoles } from '@alga-psa/types';
import { createProjectReadDecider } from './projectReadAuthorization';

export interface ProjectCompletionMetrics {
  taskCompletionPercentage: number;
  totalTasks: number;
  completedTasks: number;
  /**
   * The hours figures derive from the project's budget (`budgeted_hours`). They are ABSENT, not zero, for a reader the
   * kernel closes that column to (a seat technician): a budget of 0 would read as "no budget", and the key itself is
   * commercial. Screens render the hours section only when `budgetedHours` is present.
   */
  hoursCompletionPercentage?: number;
  budgetedHours?: number;
  spentHours?: number;
  remainingHours?: number;
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

    // A subject the kernel governs (a seat technician) may compute metrics only for a project it may read, and never
    // sees the budget-derived hours. Everyone else is unchanged: this returns after the cached tenant probe.
    // LEVERAGE: pattern resolver-governed-gate — "is this user governed by a built-in resolver?" is answered with the cached tenant probe at
    // each write/read site that only a seat technician is held to (here, task writes via ProjectReadDecision.governed, time entries, comments).
    let budgetClosed = false;
    if (await isResolverGovernedUser(trx, { tenant, user })) {
      const project = await scopedDb.table('projects').where({ project_id: projectId }).first('project_id', 'client_id', 'assigned_to');
      const decision = project ? await (await createProjectReadDecider(trx, tenant, user as IUserWithRoles))(project) : null;
      if (!decision?.allowed) throw new Error('Permission denied: Cannot read project');
      budgetClosed = decision.redactedFields.includes('budgeted_hours');
    }

    // Get project details
    const project = await scopedDb.table('projects')
      .where({
        project_id: projectId,
      })
      .first() as IProject | undefined;

    if (!project) {
      throw new Error(`Project with ID ${projectId} not found`);
    }

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

    if (budgetClosed) return { taskCompletionPercentage, totalTasks, completedTasks };

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
    const budgetedHours = Number(project.budgeted_hours || 0) / 60; // Convert minutes to hours
    // Convert billable_duration from minutes to hours
    const spentMinutes = timeEntries.reduce((total, entry) => total + entry.billable_duration, 0);
    const spentHours = spentMinutes / 60; // Convert minutes to hours for display
    const remainingHours = Math.max(0, budgetedHours - spentHours);
    const hoursCompletionPercentage = budgetedHours > 0 ? Math.min(100, (spentHours / budgetedHours) * 100) : 0;

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
