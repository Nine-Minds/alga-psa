'use server';

import { hasPermission, withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import {
  reportingActionErrorFrom,
  type ReportingActionError,
} from './report-actions/reportingActionErrors';

/** How many projects the per-project table carries; the summary covers them all. */
const PROJECT_ROW_LIMIT = 25;
/** How many task overruns the "largest overruns" section carries. */
const OVERRUN_ROW_LIMIT = 10;

export interface ProjectHoursPhaseRow {
  phaseId: string;
  phaseName: string;
  estimatedHours: number;
  actualHours: number;
  varianceHours: number;
  openTasks: number;
  closedTasks: number;
}

export interface ProjectHoursProjectRow {
  projectId: string;
  projectNumber: string;
  projectName: string;
  clientName: string;
  budgetedHours: number;
  estimatedHours: number;
  actualHours: number;
  /** actual - estimated; positive means the project has burned past its estimate. */
  varianceHours: number;
  /** actual / estimated, null when nothing was estimated. */
  percentUsed: number | null;
  /** actual / budgeted, null when the project carries no budget. */
  budgetPercentUsed: number | null;
  openTasks: number;
  closedTasks: number;
  tasksOverEstimate: number;
  phases: ProjectHoursPhaseRow[];
}

export interface ProjectHoursOverrunRow {
  taskId: string;
  taskName: string;
  projectName: string;
  phaseName: string;
  estimatedHours: number;
  actualHours: number;
  varianceHours: number;
}

export interface ProjectHoursReport {
  summary: {
    projects: number;
    budgetedHours: number;
    estimatedHours: number;
    actualHours: number;
    projectsOverEstimate: number;
    projectsOverBudget: number;
  };
  projects: ProjectHoursProjectRow[];
  topOverruns: ProjectHoursOverrunRow[];
}

function toCount(value: unknown): number {
  return Number(value ?? 0) || 0;
}

/** Estimates, actuals and budgets are all persisted as minutes. */
function minutesToHours(value: unknown): number {
  return Math.round(((Number(value ?? 0) || 0) / 60) * 10) / 10;
}

function percentOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 100);
}

async function assertCanReadReports(
  user: IUserWithRoles,
  knex: Knex,
): Promise<void> {
  if (!(await hasPermission(user, 'reports', 'read', knex))) {
    throw new Error('Permission denied: Cannot read reports');
  }
}

export const getProjectHoursReport = withAuth(
  async (user, { tenant }): Promise<ProjectHoursReport | ReportingActionError> => {
    try {
      const { knex } = await createTenantKnex();
      await assertCanReadReports(user, knex);
      const scopedDb = tenantDb(knex, tenant);

      // A task is closed when the status it maps to says so. Tenant mappings
      // point at `statuses`, seeded ones at the global `standard_statuses`, so
      // both have to be consulted — same coalesce the task actions use.
      const withTaskStatus = (query: Knex.QueryBuilder) => {
        scopedDb.tenantJoin(
          query,
          'project_status_mappings as psm',
          't.project_status_mapping_id',
          'psm.project_status_mapping_id',
          { type: 'left' },
        );
        scopedDb.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
        scopedDb.tenantJoin(
          query,
          'standard_statuses as ss',
          'psm.standard_status_id',
          'ss.standard_status_id',
          { type: 'left' },
        );
        return query;
      };
      const closedExpression = 'COALESCE(s.is_closed, ss.is_closed, false)';
      const estimatedMinutes = 'COALESCE(t.estimated_hours, 0)';
      const actualMinutes = 'COALESCE(ta.actual_minutes, 0)';

      // `project_tasks.actual_hours` is a frozen snapshot: it is written once at
      // task creation and by the 20260730 backfill, and nothing recomputes it
      // when time is logged. Reading it would report 0 actual hours forever, so
      // the actuals are rolled up live from the time entries instead, using the
      // same worked-duration expression that backfill defined. Pre-aggregating
      // per task keeps the task rows from fanning out across their entries.
      const taskActuals = () =>
        scopedDb.table('time_entries as te')
          .where('te.work_item_type', 'project_task')
          .groupBy('te.tenant', 'te.work_item_id')
          .select(
            'te.tenant',
            'te.work_item_id',
            knex.raw(
              'COALESCE(SUM(GREATEST(ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60.0), 0)), 0) as actual_minutes',
            ),
          )
          .as('ta');

      const withTaskActuals = (query: Knex.QueryBuilder) =>
        scopedDb.tenantJoinSubquery(query, taskActuals(), 'ta.work_item_id', 't.task_id', {
          type: 'left',
          rootTenantColumn: 't.tenant',
          joinedTenantColumn: 'ta.tenant',
        });

      const projectQuery = scopedDb.table('projects as p');
      scopedDb.tenantJoin(projectQuery, 'clients as c', 'p.client_id', 'c.client_id', { type: 'left' });
      scopedDb.tenantJoin(projectQuery, 'project_phases as ph', 'p.project_id', 'ph.project_id', { type: 'left' });
      scopedDb.tenantJoin(projectQuery, 'project_tasks as t', 'ph.phase_id', 't.phase_id', { type: 'left' });
      withTaskStatus(projectQuery);
      withTaskActuals(projectQuery);

      const projectRows = await projectQuery
        .where('p.is_inactive', false)
        .select(
          'p.project_id',
          'p.project_number',
          'p.project_name',
          knex.raw("COALESCE(c.client_name, '') as client_name"),
          knex.raw('COALESCE(p.budgeted_hours, 0) as budgeted_minutes'),
          knex.raw(`COALESCE(SUM(${estimatedMinutes}), 0) as estimated_minutes`),
          knex.raw(`COALESCE(SUM(${actualMinutes}), 0) as actual_minutes`),
          knex.raw(`SUM(CASE WHEN ${closedExpression} THEN 1 ELSE 0 END)::int as closed_tasks`),
          knex.raw(`SUM(CASE WHEN t.task_id IS NOT NULL AND NOT ${closedExpression} THEN 1 ELSE 0 END)::int as open_tasks`),
          knex.raw(
            `SUM(CASE WHEN ${estimatedMinutes} > 0 AND ${actualMinutes} > ${estimatedMinutes} THEN 1 ELSE 0 END)::int as tasks_over_estimate`,
          ),
        )
        .groupBy('p.project_id', 'p.project_number', 'p.project_name', 'c.client_name', 'p.budgeted_hours')
        .orderBy('actual_minutes', 'desc');

      const projects: ProjectHoursProjectRow[] = projectRows.map((row: any) => {
        const budgetedHours = minutesToHours(row.budgeted_minutes);
        const estimatedHours = minutesToHours(row.estimated_minutes);
        const actualHours = minutesToHours(row.actual_minutes);
        return {
          projectId: row.project_id,
          projectNumber: row.project_number || '',
          projectName: row.project_name || '',
          clientName: row.client_name || '',
          budgetedHours,
          estimatedHours,
          actualHours,
          varianceHours: Math.round((actualHours - estimatedHours) * 10) / 10,
          percentUsed: percentOf(actualHours, estimatedHours),
          budgetPercentUsed: percentOf(actualHours, budgetedHours),
          openTasks: toCount(row.open_tasks),
          closedTasks: toCount(row.closed_tasks),
          tasksOverEstimate: toCount(row.tasks_over_estimate),
          phases: [],
        };
      });

      const summary = {
        projects: projects.length,
        budgetedHours: Math.round(projects.reduce((total, row) => total + row.budgetedHours, 0) * 10) / 10,
        estimatedHours: Math.round(projects.reduce((total, row) => total + row.estimatedHours, 0) * 10) / 10,
        actualHours: Math.round(projects.reduce((total, row) => total + row.actualHours, 0) * 10) / 10,
        projectsOverEstimate: projects.filter((row) => row.estimatedHours > 0 && row.actualHours > row.estimatedHours).length,
        projectsOverBudget: projects.filter((row) => row.budgetedHours > 0 && row.actualHours > row.budgetedHours).length,
      };

      const topProjects = projects.slice(0, PROJECT_ROW_LIMIT);
      const projectIds = topProjects.map((row) => row.projectId);

      if (projectIds.length === 0) {
        return { summary, projects: topProjects, topOverruns: [] };
      }

      const phaseQuery = scopedDb.table('project_phases as ph');
      scopedDb.tenantJoin(phaseQuery, 'project_tasks as t', 'ph.phase_id', 't.phase_id', { type: 'left' });
      withTaskStatus(phaseQuery);
      withTaskActuals(phaseQuery);

      const overrunQuery = scopedDb.table('project_tasks as t');
      scopedDb.tenantJoin(overrunQuery, 'project_phases as ph', 't.phase_id', 'ph.phase_id');
      scopedDb.tenantJoin(overrunQuery, 'projects as p', 'ph.project_id', 'p.project_id');
      withTaskActuals(overrunQuery);

      const [phaseRows, overrunRows] = await Promise.all([
        phaseQuery
          .whereIn('ph.project_id', projectIds)
          .select(
            'ph.project_id',
            'ph.phase_id',
            'ph.phase_name',
            knex.raw(`COALESCE(SUM(${estimatedMinutes}), 0) as estimated_minutes`),
            knex.raw(`COALESCE(SUM(${actualMinutes}), 0) as actual_minutes`),
            knex.raw(`SUM(CASE WHEN ${closedExpression} THEN 1 ELSE 0 END)::int as closed_tasks`),
            knex.raw(`SUM(CASE WHEN t.task_id IS NOT NULL AND NOT ${closedExpression} THEN 1 ELSE 0 END)::int as open_tasks`),
          )
          .groupBy('ph.project_id', 'ph.phase_id', 'ph.phase_name', 'ph.order_number')
          .orderBy('ph.order_number', 'asc'),
        overrunQuery
          .whereIn('ph.project_id', projectIds)
          .whereRaw(`${estimatedMinutes} > 0`)
          .whereRaw(`${actualMinutes} > ${estimatedMinutes}`)
          .select(
            't.task_id',
            't.task_name',
            'p.project_name',
            'ph.phase_name',
            knex.raw(`${estimatedMinutes} as estimated_minutes`),
            knex.raw(`${actualMinutes} as actual_minutes`),
            knex.raw(`(${actualMinutes} - ${estimatedMinutes}) as variance_minutes`),
          )
          .orderBy('variance_minutes', 'desc')
          .limit(OVERRUN_ROW_LIMIT),
      ]);

      const projectsById = new Map(topProjects.map((row) => [row.projectId, row]));
      for (const row of phaseRows as any[]) {
        const project = projectsById.get(row.project_id);
        if (!project) continue;
        const estimatedHours = minutesToHours(row.estimated_minutes);
        const actualHours = minutesToHours(row.actual_minutes);
        project.phases.push({
          phaseId: row.phase_id,
          phaseName: row.phase_name || '',
          estimatedHours,
          actualHours,
          varianceHours: Math.round((actualHours - estimatedHours) * 10) / 10,
          openTasks: toCount(row.open_tasks),
          closedTasks: toCount(row.closed_tasks),
        });
      }

      const topOverruns: ProjectHoursOverrunRow[] = (overrunRows as any[]).map((row) => ({
        taskId: row.task_id,
        taskName: row.task_name || '',
        projectName: row.project_name || '',
        phaseName: row.phase_name || '',
        estimatedHours: minutesToHours(row.estimated_minutes),
        actualHours: minutesToHours(row.actual_minutes),
        varianceHours: minutesToHours(row.variance_minutes),
      }));

      return { summary, projects: topProjects, topOverruns };
    } catch (error) {
      const expected = reportingActionErrorFrom(error);
      if (expected) return expected;
      throw error;
    }
  },
);
