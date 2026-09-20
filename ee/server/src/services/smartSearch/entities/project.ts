/**
 * Smart search over the Projects list.
 *
 * Scope: the chip-filtered project ids the page holds (the Projects list is
 * filtered in the browser over the whole set), re-authorized here per row.
 * Candidate text: name, number, client, contact, manager, description, the
 * project's current facts (status, closed and inactive flags, dates, budget)
 * as named text, then its tasks newest-updated first (phase, name, status,
 * assignee, priority, due date, description) and finally recent task comments
 * from `app_search_index`, which carries the same visibility columns keyword
 * search filters on. Tasks take budget before comments: a project is mostly
 * described by what it has to get done.
 */

import type { Knex } from 'knex';
import { z } from 'zod';
import { tenantDb } from '@alga-psa/db';
import { authorizeProjectIds, loadProjectListItemsByIds } from '@alga-psa/projects/actions/projectActions';
import type { ProjectSmartSearchRowMetadata, ProjectSmartSearchScope } from '@alga-psa/projects/lib/smartProjectSearch/types';
import { aclPredicateSql, resolveSearchAclPrincipal, type SearchAclPrincipal } from '@alga-psa/search/acl';
import type { IProject, IUserWithRoles } from '@alga-psa/types';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

import { SMART_SEARCH_BUDGETS, type CandidateBudgets } from '../budgets';
import {
  assembleCandidate,
  nonEmpty,
  normalizeRichText,
  toIso,
  type CandidateChild,
  type SmartSearchCandidate,
} from '../candidate';
import type { SmartSearchEntityDefinition } from '../entityDefinition';
import type { RelevancePrompt } from '../scoreBatch';

export const projectSmartSearchScopeSchema = z.object({
  projectIds: z.array(z.string().uuid()),
});

export interface ProjectTextRow {
  project_id: string;
  project_number: string | null;
  project_name: string | null;
  description: string | null;
  client_name: string | null;
  contact_name: string | null;
  status_name: string | null;
  is_closed: boolean | null;
  is_inactive: boolean | null;
  manager_name: string | null;
  start_date: Date | string | null;
  end_date: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  budgeted_hours: number | string | null;
}

export interface ProjectTaskRow {
  project_id: string;
  phase_name: string | null;
  task_name: string | null;
  description: string | null;
  status_name: string | null;
  is_closed: boolean | null;
  priority_name: string | null;
  assigned_to_name: string | null;
  due_date: Date | string | null;
  updated_at: Date | string | null;
}

export interface ProjectCommentRow {
  project_id: string;
  task_name: string | null;
  body: string | null;
  source_updated_at: Date | string;
}

/** The JSON Jev reads for one project. `tasks` and `comments` must be newest first. Exported for tests. */
export function assembleProjectCandidate(
  row: ProjectTextRow,
  tasks: ProjectTaskRow[],
  comments: ProjectCommentRow[],
  budgets: CandidateBudgets = SMART_SEARCH_BUDGETS
): SmartSearchCandidate {
  const budgetedHours = row.budgeted_hours === null || row.budgeted_hours === undefined ? null : Number(row.budgeted_hours);
  return assembleCandidate(
    {
      id: row.project_id,
      head: {
        project_number: row.project_number ?? '',
        project_name: row.project_name?.trim() || row.project_number || row.project_id,
        client: nonEmpty(row.client_name),
        contact: nonEmpty(row.contact_name),
        status: nonEmpty(row.status_name),
        is_closed: row.is_closed === true,
        is_inactive: row.is_inactive === true,
        project_manager: nonEmpty(row.manager_name),
        start_date: toIso(row.start_date),
        end_date: toIso(row.end_date),
        created_at: toIso(row.created_at),
        updated_at: toIso(row.updated_at),
        budgeted_hours: budgetedHours !== null && Number.isFinite(budgetedHours) ? budgetedHours : null,
      },
      description: row.description,
      sections: [
        {
          key: 'tasks',
          items: tasks.map(
            (task): CandidateChild => ({
              phase: nonEmpty(task.phase_name),
              task: task.task_name?.trim() ?? '',
              status: nonEmpty(task.status_name),
              is_closed: task.is_closed === true,
              priority: nonEmpty(task.priority_name),
              assigned_to: nonEmpty(task.assigned_to_name),
              due_date: toIso(task.due_date),
              text: normalizeRichText(task.description),
            })
          ),
        },
        {
          key: 'comments',
          items: comments
            .map((comment): CandidateChild => ({ task: nonEmpty(comment.task_name), text: normalizeRichText(comment.body) }))
            .filter((comment) => comment.text.length > 0),
        },
      ],
    },
    budgets
  );
}

async function loadProjectTextRows(trx: Knex.Transaction, tenant: string, projectIds: string[]): Promise<ProjectTextRow[]> {
  const db = tenantDb(trx, tenant);
  const query = db.table('projects as p');
  db.tenantJoin(query, 'clients as c', 'p.client_id', 'c.client_id', { type: 'left' });
  db.tenantJoin(query, 'contacts as ct', 'p.contact_name_id', 'ct.contact_name_id', { type: 'left' });
  db.tenantJoin(query, 'statuses as s', 'p.status', 's.status_id', { type: 'left' });
  db.tenantJoin(query, 'users as mu', 'p.assigned_to', 'mu.user_id', { type: 'left' });
  return query
    .whereIn('p.project_id', projectIds)
    .select(
      'p.project_id',
      'p.project_number',
      'p.project_name',
      'p.description',
      'c.client_name',
      'ct.full_name as contact_name',
      's.name as status_name',
      's.is_closed',
      'p.is_inactive',
      trx.raw("NULLIF(TRIM(CONCAT(mu.first_name, ' ', mu.last_name)), '') as manager_name"),
      'p.start_date',
      'p.end_date',
      'p.created_at',
      'p.updated_at',
      'p.budgeted_hours'
    );
}

async function loadProjectTaskRows(trx: Knex.Transaction, tenant: string, projectIds: string[]): Promise<ProjectTaskRow[]> {
  const db = tenantDb(trx, tenant);
  // Newest-updated first per project, capped per project so a 300-task project
  // does not pull 300 rows the budget will throw away.
  const query = db.table('project_tasks as pt');
  db.tenantJoin(query, 'project_phases as ph', 'pt.phase_id', 'ph.phase_id');
  db.tenantJoin(query, 'project_status_mappings as psm', 'pt.project_status_mapping_id', 'psm.project_status_mapping_id', { type: 'left' });
  db.tenantJoin(query, 'statuses as ts', 'psm.status_id', 'ts.status_id', { type: 'left' });
  db.tenantJoin(query, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
  db.tenantJoin(query, 'priorities as pr', 'pt.priority_id', 'pr.priority_id', { type: 'left' });
  db.tenantJoin(query, 'users as au', 'pt.assigned_to', 'au.user_id', { type: 'left' });
  const ranked = query
    .whereIn('ph.project_id', projectIds)
    .select(
      'ph.project_id',
      'ph.phase_name',
      'pt.task_name',
      'pt.description',
      trx.raw("COALESCE(NULLIF(psm.custom_name, ''), ts.name, ss.name) as status_name"),
      trx.raw('COALESCE(ts.is_closed, ss.is_closed, false) as is_closed'),
      'pr.priority_name',
      trx.raw("NULLIF(TRIM(CONCAT(au.first_name, ' ', au.last_name)), '') as assigned_to_name"),
      'pt.due_date',
      'pt.updated_at',
      trx.raw('ROW_NUMBER() OVER (PARTITION BY ph.project_id ORDER BY pt.updated_at DESC NULLS LAST) AS rn')
    )
    .as('ranked');

  return trx
    .from(ranked)
    .where('rn', '<=', SMART_SEARCH_BUDGETS.childRowsPerCandidateFetchLimit)
    .orderBy([{ column: 'project_id' }, { column: 'updated_at', order: 'desc' }])
    .select(
      'project_id',
      'phase_name',
      'task_name',
      'description',
      'status_name',
      'is_closed',
      'priority_name',
      'assigned_to_name',
      'due_date',
      'updated_at'
    );
}

async function loadVisibleCommentRows(
  trx: Knex.Transaction,
  tenant: string,
  principal: SearchAclPrincipal,
  projectIds: string[]
): Promise<ProjectCommentRow[]> {
  const acl = aclPredicateSql(principal);
  // Task comments index under their task; two joins climb back to the project.
  const db = tenantDb(trx, tenant);
  const query = db.table('app_search_index as si');
  db.tenantJoin(query, 'project_tasks as pt', 'si.parent_id', 'pt.task_id');
  db.tenantJoin(query, 'project_phases as ph', 'pt.phase_id', 'ph.phase_id');
  const ranked = query
    .where('si.object_type', 'project_task_comment')
    .whereIn('ph.project_id', projectIds)
    .whereRaw(acl.sql, acl.bindings)
    .select(
      'ph.project_id',
      'si.title as task_name',
      'si.body',
      'si.source_updated_at',
      trx.raw('ROW_NUMBER() OVER (PARTITION BY ph.project_id ORDER BY si.source_updated_at DESC) AS rn')
    )
    .as('ranked');

  return trx
    .from(ranked)
    .where('rn', '<=', SMART_SEARCH_BUDGETS.childRowsPerCandidateFetchLimit)
    .orderBy([{ column: 'project_id' }, { column: 'source_updated_at', order: 'desc' }])
    .select('project_id', 'task_name', 'body', 'source_updated_at');
}

function groupBy<T extends { project_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.project_id) ?? [];
    list.push(row);
    map.set(row.project_id, list);
  }
  return map;
}

export async function loadProjectCandidates(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projectIds: string[]
): Promise<SmartSearchCandidate[]> {
  if (projectIds.length === 0) {
    return [];
  }
  const principal = await resolveSearchAclPrincipal(trx, user);
  const [projectRows, taskRows, commentRows] = await Promise.all([
    loadProjectTextRows(trx, tenant, projectIds),
    loadProjectTaskRows(trx, tenant, projectIds),
    loadVisibleCommentRows(trx, tenant, principal, projectIds),
  ]);
  const tasksByProject = groupBy(taskRows);
  const commentsByProject = groupBy(commentRows);

  const rowsById = new Map(projectRows.map((row) => [row.project_id, row] as const));
  const candidates: SmartSearchCandidate[] = [];
  for (const projectId of projectIds) {
    const row = rowsById.get(projectId);
    if (!row) {
      // Deleted between enumeration and load; the runner reports it as unscored.
      continue;
    }
    candidates.push(
      assembleProjectCandidate(row, tasksByProject.get(projectId) ?? [], commentsByProject.get(projectId) ?? [])
    );
  }
  return candidates;
}

export const PROJECT_RELEVANCE: RelevancePrompt = {
  question: (index) =>
    `Is the project at \`candidates[${index}]\` about the work, deliverable, client, ` +
    'person, or subject described by `query`? The candidate carries its current status, ' +
    'is_closed and is_inactive flags, project_manager, contact, client, and start_date, ' +
    'end_date, created_at, and updated_at as ISO 8601 date-times, plus its tasks (each with ' +
    'phase, status, assigned_to, priority, and due_date) and recent task comments; use the ' +
    'facts only when `query` refers to such things.',
  criteria: {
    true:
      'The project concerns what the query describes, even when it uses different words, ' +
      'names a specific product or vendor where the query names a category, or when the match ' +
      'is in one of its tasks or comments rather than the project name. When the query mentions ' +
      'a status, whether the project is closed or inactive, a manager, contact, or client, or a ' +
      'time such as a deadline or when it started, was created, or was updated, the project ' +
      'matches on those too.',
    false:
      'The project is about different work, or the query names a status, closed or inactive ' +
      'state, manager, contact, client, or time that the project does not match. Sharing a ' +
      'client, a manager, or a few incidental words the query does not ask about does not make ' +
      'it relevant.',
  },
};

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
}

export const projectSmartSearch: SmartSearchEntityDefinition<ProjectSmartSearchScope, IProject, ProjectSmartSearchRowMetadata> = {
  entity: 'project',
  permissionResource: 'project',
  noun: 'projects',
  scopeSchema: projectSmartSearchScopeSchema,
  normalizeScope: (scope) => ({ projectIds: uniqueIds(scope.projectIds) }),
  enumerate: (scope) => authorizeProjectIds(scope.projectIds),
  loadCandidates: loadProjectCandidates,
  hydrateRows: async (_scope, ids) => {
    const result = await loadProjectListItemsByIds(ids);
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      return result;
    }
    return { rows: result.projects, metadata: result.metadata };
  },
  rowId: (project) => project.project_id,
  relevance: PROJECT_RELEVANCE,
};
