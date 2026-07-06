'use server'

import { IProject, IProjectTask } from 'server/src/interfaces/project.interfaces';
import { ITimeEntry } from 'server/src/interfaces/timeEntry.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { tenantDb } from '@alga-psa/db';

export interface ProjectCompletionMetrics {
  taskCompletionPercentage: number;
  hoursCompletionPercentage: number;
  totalTasks: number;
  completedTasks: number;
  budgetedHours: number;
  spentHours: number;
  remainingHours: number;
}

/**
 * Calculate project completion metrics based on tasks and hours
 * @param projectId The project ID to calculate metrics for
 * @returns ProjectCompletionMetrics object with task and hours-based completion percentages
 */
export async function calculateProjectCompletion(projectId: string): Promise<ProjectCompletionMetrics> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context not found');
  }

  const scopedDb = tenantDb(db, tenant);

  // Get project details
  const project = await scopedDb.table<IProject>('projects')
    .where('project_id', projectId)
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
  scopedDb.tenantJoin(
    tasksQuery,
    'statuses',
    'project_status_mappings.status_id',
    'statuses.status_id',
    { type: 'left' }
  );
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
  scopedDb.tenantJoin(timeEntriesQuery, 'project_tasks', 'time_entries.work_item_id', 'project_tasks.task_id');
  scopedDb.tenantJoin(timeEntriesQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
  const timeEntries = await timeEntriesQuery
    .where('project_phases.project_id', projectId)
    .where('time_entries.work_item_type', 'project_task')
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
}
