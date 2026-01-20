'use server'

import type { IProject, IProjectTask, ITimeEntry } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';

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

  // Get project details
  const project = await db('projects')
    .where({
      project_id: projectId,
      tenant
    })
    .first() as IProject | undefined;

  if (!project) {
    throw new Error(`Project with ID ${projectId} not found`);
  }

  // Get all tasks for the project
  const tasks = await db<IProjectTask>('project_tasks')
    .join('project_phases', function() {
      this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
          .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
    })
    .leftJoin('project_status_mappings', function() {
      this.on('project_tasks.project_status_mapping_id', '=', 'project_status_mappings.project_status_mapping_id')
          .andOn('project_tasks.tenant', '=', 'project_status_mappings.tenant');
    })
    .leftJoin('statuses', function() {
      this.on('project_status_mappings.status_id', '=', 'statuses.status_id')
          .andOn('project_status_mappings.tenant', '=', 'statuses.tenant');
    })
    .where({
      'project_phases.project_id': projectId,
      'project_tasks.tenant': tenant
    })
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
  const timeEntries = await db<ITimeEntry>('time_entries')
    .join('project_tasks', function() {
      this.on('time_entries.work_item_id', '=', 'project_tasks.task_id')
          .andOn('time_entries.tenant', '=', 'project_tasks.tenant')
          .andOn('time_entries.work_item_type', '=', db.raw("'project_task'"));
    })
    .join('project_phases', function() {
      this.on('project_tasks.phase_id', '=', 'project_phases.phase_id')
          .andOn('project_tasks.tenant', '=', 'project_phases.tenant');
    })
    .where({
      'project_phases.project_id': projectId,
      'time_entries.tenant': tenant
    })
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
