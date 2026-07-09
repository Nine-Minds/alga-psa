'use server';

import { Knex } from 'knex';
import ProjectModel from '../models/project';
import ProjectTaskModel from '../models/projectTask';
import type {
  IClient,
  IProject,
  IProjectPhase,
  IProjectStatusMapping,
  IProjectTask,
  IProjectTicketLink,
  IProjectTicketLinkWithDetails,
  IStandardStatus,
  IStatus,
  ITaskChecklistItem,
  DeletionValidationResult,
  IUser,
  IUserWithRoles,
  ItemType,
  ProjectPhaseStatus,
  ProjectStatus,
  ProjectWithPhases,
} from '@alga-psa/types';
import { getAllUsers, findUserById } from '@alga-psa/user-composition/actions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- server action calling another server action; cannot use React context composition
import { getContactByContactNameId } from '@alga-psa/clients/actions/contact-actions/contactActions';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { validateArray, validateData } from '@alga-psa/validation';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { getClientLogoUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { z } from 'zod';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { createProjectSchema, updateProjectSchema, projectPhaseSchema } from '../schemas/project.schemas';
import { OrderingService } from '../lib/orderingUtils';
import { projectKanbanHiddenStatusesKey } from '../lib/kanbanPreferences';
import { SharedNumberingService } from '@shared/services/numberingService';
import {
  buildProjectStatusChangedPayload,
  buildProjectUpdatedPayload,
} from '@alga-psa/workflow-streams';
import { deleteEntityWithValidation } from '@alga-psa/core/server';
import { deleteEntityTags, deleteEntitiesTags } from '@alga-psa/tags/lib/tagCleanup';
import { actionError, isActionMessageError, isActionPermissionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { filterAuthorizedTicketIds } from './projectTaskActions';
import { applyTicketLinkRestriction } from '../lib/taskTicketMapping';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
} from '@alga-psa/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from '@alga-psa/authorization/bundles/service';

type ProjectActionError = ActionMessageError | ActionPermissionError;

const PROJECT_LIST_SEARCH_TSQUERY_UNSAFE_RE = /[^\p{L}\p{N}\s]+/gu;
const PROJECT_LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN = /\b[A-Z]+-?\d+\b/i;
const PROJECT_LIST_SEARCH_TYPES = ['project', 'project_phase', 'project_task', 'project_task_comment'] as const;

const EXPECTED_PROJECT_ACTION_ERROR_PREFIXES = [
    'No projects available with valid phases',
    'No projects found',
    'Phase not found',
    'Project not found',
    'Project phase not found',
    'Project status not found',
];

function projectActionErrorFrom(error: unknown): ProjectActionError | null {
    if (isActionMessageError(error) || isActionPermissionError(error)) {
        return error;
    }

    const issues = (error as { issues?: unknown })?.issues;
    if (Array.isArray(issues) && issues.length > 0) {
        return actionError('Project validation failed. Please review the project details and try again.');
    }

    if (error instanceof Error) {
        if (error.message.includes('Permission denied')) {
            return permissionError(error.message);
        }
        if (EXPECTED_PROJECT_ACTION_ERROR_PREFIXES.some((message) => error.message.startsWith(message))) {
            return actionError(error.message);
        }
        if (error.message.startsWith('Project ') && error.message.includes(' not found in tenant ')) {
            return actionError('Project not found');
        }
    }

    const dbError = error as { code?: string; column?: string };
    if (dbError?.code === '22P02') {
        return actionError('One of the selected project values is invalid. Please refresh and try again.');
    }
    if (dbError?.code === '23502') {
        return actionError(`Missing required project field${dbError.column ? `: ${dbError.column}` : ''}.`);
    }
    if (dbError?.code === '23503') {
        return actionError('One of the selected project records no longer exists. Please refresh and try again.');
    }
    if (dbError?.code === '23505') {
        return actionError('This project change conflicts with an existing record. Please refresh and try again.');
    }
    if (dbError?.code === '23514') {
        return actionError('One of the project values is not allowed. Please review the form and try again.');
    }

    return null;
}

function projectDeleteErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        if (error.message.includes('Permission denied')) {
            return error.message;
        }
        if (error.message.includes('not found')) {
            return 'Project not found';
        }
        if (error.message.includes('violates foreign key constraint')) {
            return 'Cannot delete project because it has associated records';
        }
        if (error.message.includes('connection') || error.message.includes('timeout')) {
            return 'Database connection issue. Please try again.';
        }
    }

    return 'Unable to delete project. Please refresh and try again.';
}

const extendedCreateProjectSchema = createProjectSchema.extend({
  assigned_to: z.string().nullable().optional(),
  contact_name_id: z.string().nullable().optional(),
  budgeted_hours: z.number().nullable().optional()
}).transform((data) => ({
  ...data,
  assigned_to: data.assigned_to || null,
  contact_name_id: data.contact_name_id || null
}));

const extendedUpdateProjectSchema = updateProjectSchema.extend({
  assigned_to: z.string().nullable().optional(),
  contact_name_id: z.string().nullable().optional(),
  budgeted_hours: z.number().nullable().optional()
}).transform((data) => ({
  ...data,
  assigned_to: data.assigned_to || null,
  contact_name_id: data.contact_name_id || null
}));

type DbConnection = Knex | Knex.Transaction;

function tenantScopedTable(
  conn: DbConnection,
  table: string,
  tenant: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function tenantScopedDerivedTableSql(
  facade: ReturnType<typeof tenantDb>,
  tableName: string,
  alias: string,
): { subquery: Knex.QueryBuilder; sql: string; bindings: Knex.RawBinding[] } {
  const subquery = facade
    .subquery(tableName)
    .select('*')
    .as(alias);
  const scoped = subquery.toSQL();

  return {
    subquery,
    sql: `(${scoped.sql}) ${alias}`,
    bindings: scoped.bindings as Knex.RawBinding[],
  };
}

function tenantJoinSubquerySql(
  facade: ReturnType<typeof tenantDb>,
  conn: DbConnection,
  subquery: Knex.QueryBuilder | Knex.Raw,
  left: string | Knex.Raw,
  right: string | Knex.Raw,
  options: Parameters<ReturnType<typeof tenantDb>['tenantJoinSubquery']>[4]
): { sql: string; bindings: Knex.RawBinding[] } {
  const fragmentSource = (conn as Knex)('__tenant_join_fragment__').select(conn.raw('1'));

  facade.tenantJoinSubquery(
    fragmentSource,
    subquery as unknown as Knex.QueryBuilder,
    left as unknown as string,
    right as unknown as string,
    options
  );

  const compiled = fragmentSource.toSQL();
  const marker = ' from "__tenant_join_fragment__" ';
  const markerIndex = compiled.sql.indexOf(marker);

  if (markerIndex < 0) {
    throw new Error('Tenant join subquery SQL fragment marker was not present in compiled SQL.');
  }

  return {
    sql: compiled.sql.slice(markerIndex + marker.length),
    bindings: compiled.bindings as Knex.RawBinding[],
  };
}

async function checkPermission(user: IUser, resource: string, action: string, knexConnection?: Knex | Knex.Transaction): Promise<ActionPermissionError | null> {
    try {
        const hasPermissionResult = await hasPermission(user, resource, action, knexConnection);
        if (!hasPermissionResult) {
            return permissionError(`Permission denied: Cannot ${action} ${resource}`);
        }
        return null;
    } catch (error) {
        if (typeof error === 'string' && error.includes('Permission denied')) {
            return permissionError(error);
        }
        if (error instanceof Error && error.message.includes('Permission denied')) {
            return permissionError(error.message);
        }
        throw error;
    }
}

async function getContactFullNameByContactNameId(params: {
    knexOrTrx: Knex | Knex.Transaction;
    tenant: string;
    contactNameId: string;
}): Promise<string | null> {
    const row = await tenantScopedTable(params.knexOrTrx, 'contacts', params.tenant)
        .where({ contact_name_id: params.contactNameId })
        .first<{ full_name: string }>('full_name');
    return row?.full_name ?? null;
}

function extractRoleIdsFromUser(user: IUserWithRoles): string[] {
  if (!Array.isArray(user.roles)) {
    return [];
  }

  return user.roles
    .map((role) => {
      if (typeof role === 'string') {
        return role;
      }
      return typeof role?.role_id === 'string' ? role.role_id : null;
    })
    .filter((value): value is string => Boolean(value));
}

async function resolveAuthorizationSubjectForUser(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<AuthorizationSubject> {
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await tenantScopedTable(trx, 'user_roles', tenant)
        .where({ user_id: user.user_id })
        .select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  const [teamRows, managedRows] = await Promise.all([
    tenantScopedTable(trx, 'team_members', tenant).where({ user_id: user.user_id }).select<{ team_id: string }[]>('team_id').catch(() => []),
    tenantScopedTable(trx, 'users', tenant).where({ reports_to: user.user_id }).select<{ user_id: string }[]>('user_id').catch(() => []),
  ]);

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

function toProjectAuthorizationRecord(project: Partial<IProject>): AuthorizationRecord {
  const assignedUserIds =
    typeof project.assigned_to === 'string' && project.assigned_to.length > 0 ? [project.assigned_to] : [];

  return {
    id: project.project_id ?? null,
    ownerUserId: project.assigned_to ?? null,
    assignedUserIds,
    clientId: project.client_id ?? null,
  };
}

async function createProjectReadAuthorizer(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles
): Promise<(project: Partial<IProject>) => Promise<boolean>> {
  const subject = await resolveAuthorizationSubjectForUser(trx, tenant, user);
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(trx, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();

  return async (project: Partial<IProject>): Promise<boolean> => {
    const projectId = project.project_id;
    if (!projectId) {
      return false;
    }

    const decision = await authorizationKernel.authorizeResource({
      subject,
      resource: {
        type: 'project',
        action: 'read',
        id: projectId,
      },
      record: toProjectAuthorizationRecord(project),
      requestCache,
      knex: trx,
    });

    return decision.allowed;
  };
}

async function filterAuthorizedProjects<T extends Partial<IProject>>(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projects: T[]
): Promise<T[]> {
  if (projects.length === 0) {
    return [];
  }

  const authorizeProjectRead = await createProjectReadAuthorizer(trx, tenant, user);
  const decisions = await Promise.all(projects.map((project) => authorizeProjectRead(project)));
  return projects.filter((_, index) => decisions[index]);
}

async function assertProjectReadAllowed(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projectId: string
): Promise<IProject> {
  const project = await ProjectModel.getById(trx, tenant, projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const authorizeProjectRead = await createProjectReadAuthorizer(trx, tenant, user);
  if (!await authorizeProjectRead(project)) {
    throw new Error('Permission denied: Cannot read project');
  }

  return project;
}

async function resolveProjectIdForPhase(
  trx: Knex.Transaction,
  tenant: string,
  phaseId: string
): Promise<string | null> {
  const row = await tenantScopedTable(trx, 'project_phases', tenant)
    .where({ phase_id: phaseId })
    .first<{ project_id: string }>('project_id');

  return row?.project_id ?? null;
}

async function resolveProjectIdsForStatus(
  trx: Knex.Transaction,
  tenant: string,
  statusId: string
): Promise<string[]> {
  const rows = await tenantScopedTable(trx, 'project_status_mappings', tenant)
    .where({ status_id: statusId })
    .select<{ project_id: string }[]>('project_id');

  return Array.from(new Set(rows.map((row) => row.project_id)));
}

export const getAllClientsForProjects = withAuth(async (_user, { tenant }): Promise<IClient[]> => {
  const { knex: db } = await createTenantKnex();

  const clients = await withTransaction(db, async (trx: Knex.Transaction) => {
    return tenantScopedTable(trx, 'clients', tenant).select('*').orderBy('client_name', 'asc');
  });

  if (clients.length === 0) {
    return [];
  }

  // Batch-resolve logo URLs once (no N+1) so the projects table can show real logos.
  const logoUrlsMap = await getClientLogoUrlsBatch(clients.map((c: any) => c.client_id), tenant);

  return clients.map((c: any) => ({
    ...c,
    logoUrl: logoUrlsMap.get(c.client_id) ?? null,
  })) as IClient[];
});

export const getProjects = withAuth(async (user, { tenant }): Promise<IProject[] | ActionPermissionError> => {
    try {
        const { knex } = await createTenantKnex();

        const denied = await checkPermission(user, 'project', 'read', knex);
        if (denied) return denied;

        const projects = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const rows = await ProjectModel.getAll(trx, tenant, true);
            return await filterAuthorizedProjects(trx, tenant, user as IUserWithRoles, rows);
        });

        // Use assigned user data already available from the JOIN in ProjectModel.getAll()
        const projectsWithUsers = projects.map((project): IProject => {
            if (project.assigned_to && (project as any).assigned_to_first_name) {
                return {
                    ...project,
                    assigned_user: {
                        user_id: project.assigned_to,
                        first_name: (project as any).assigned_to_first_name,
                        last_name: (project as any).assigned_to_last_name,
                    } as any
                };
            }
            return project;
        });

        return projectsWithUsers;
    } catch (error) {
        console.error('Error fetching projects:', error);
        throw error;
    }
});

function buildProjectListSearchPrefixTsquery(raw: string): string | null {
  const tokens = raw
    .toLowerCase()
    .replace(PROJECT_LIST_SEARCH_TSQUERY_UNSAFE_RE, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}:*`).join(' & ');
}

export const searchProjectListIds = withAuth(async (
  user,
  { tenant },
  query: string
): Promise<string[]> => {
  const rawSearch = query.replace(/\s+/g, ' ').trim();
  if (!rawSearch) {
    return [];
  }

  const { knex } = await createTenantKnex();
  const denied = await checkPermission(user, 'project', 'read', knex);
  if (denied) {
    return [];
  }

  const prefixTsquery = buildProjectListSearchPrefixTsquery(rawSearch);
  const identifier = rawSearch.match(PROJECT_LIST_SEARCH_IDENTIFIER_TOKEN_PATTERN)?.[0]?.toLowerCase() ?? null;
  const isInternalUser = user.user_type !== 'client';
  const clientScopePredicate = isInternalUser
    ? 'TRUE'
    : user.clientId
      ? '(si.client_scope_id IS NULL OR si.client_scope_id = ?::uuid)'
      : 'si.client_scope_id IS NULL';
  const clientScopeBindings = isInternalUser || !user.clientId ? [] : [user.clientId];

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const scopedDb = tenantDb(trx, tenant);
    const searchIndex = tenantScopedDerivedTableSql(scopedDb, 'app_search_index', 'si');
    const projectTasks = tenantScopedDerivedTableSql(scopedDb, 'project_tasks', 'pt');
    const projectPhases = tenantScopedDerivedTableSql(scopedDb, 'project_phases', 'ph');
    const projectTaskCommentJoin = tenantJoinSubquerySql(
      scopedDb,
      trx,
      projectTasks.subquery,
      trx.raw('??::text', ['pt.task_id']),
      'si.parent_id',
      {
        type: 'left',
        rootTenantColumn: 'si.tenant',
        joinedTenantColumn: 'pt.tenant',
        on: (join) => {
          join.andOn('si.object_type', '=', trx.raw("'project_task_comment'"));
        },
      }
    );
    const projectPhaseJoin = tenantJoinSubquerySql(
      scopedDb,
      trx,
      projectPhases.subquery,
      'ph.phase_id',
      'pt.phase_id',
      {
        type: 'left',
        rootTenantColumn: 'pt.tenant',
        joinedTenantColumn: 'ph.tenant',
      }
    );
    const result = await trx.raw<{ rows: Array<{ project_id: string }> }>(
      `
        WITH q AS (
          SELECT
            websearch_to_tsquery('english', ?) AS tsq,
            CASE WHEN ?::text IS NULL THEN NULL ELSE to_tsquery('english', ?::text) END AS prefix_tsq,
            ?::text AS raw,
            ?::text AS identifier
        ),
        matched AS (
          SELECT DISTINCT
            CASE
              WHEN si.object_type = 'project' THEN si.object_id
              WHEN si.object_type IN ('project_phase', 'project_task') THEN si.parent_id
              WHEN si.object_type = 'project_task_comment' THEN ph.project_id::text
            END AS project_id
          FROM ${searchIndex.sql}
          CROSS JOIN q
          ${projectTaskCommentJoin.sql}
          ${projectPhaseJoin.sql}
          WHERE si.object_type = ANY(?::text[])
            AND (si.required_permission IS NULL OR si.required_permission = ANY(?::text[]))
            AND (cardinality(si.visible_to_user_ids) = 0 OR si.visible_to_user_ids && ARRAY[?]::uuid[])
            AND (si.is_internal_only = false OR ?::boolean = true)
            AND (si.is_private = false OR si.visible_to_user_ids && ARRAY[?]::uuid[])
            AND ${clientScopePredicate}
            AND (
              si.search_vector @@ q.tsq
              OR (q.prefix_tsq IS NOT NULL AND si.search_vector @@ q.prefix_tsq)
              OR si.title ILIKE '%' || q.raw || '%'
              OR coalesce(si.subtitle, '') ILIKE '%' || q.raw || '%'
              OR si.title % q.raw
              OR coalesce(si.subtitle, '') % q.raw
              OR (
                q.identifier IS NOT NULL
                AND lower(coalesce(si.metadata->>'identifier', '')) = q.identifier
              )
              OR (
                q.identifier IS NOT NULL
                AND lower(coalesce(si.metadata->>'identifier', '')) LIKE q.identifier || '%'
              )
            )
        )
        SELECT project_id
        FROM matched
        WHERE project_id IS NOT NULL
      `,
      [
        rawSearch,
        prefixTsquery,
        prefixTsquery,
        rawSearch,
        identifier,
        ...searchIndex.bindings,
        ...projectTaskCommentJoin.bindings,
        ...projectPhaseJoin.bindings,
        [...PROJECT_LIST_SEARCH_TYPES],
        ['project:read'],
        user.user_id,
        isInternalUser,
        user.user_id,
        ...clientScopeBindings,
      ]
    );

    const projectIds = result.rows.map((row) => row.project_id);
    if (projectIds.length === 0) {
      return [];
    }

    const matchedProjects = await tenantScopedTable(trx, 'projects', tenant)
      .whereIn('project_id', projectIds)
      .select<IProject[]>('project_id', 'assigned_to', 'client_id');
    const authorizedProjects = await filterAuthorizedProjects(trx, tenant, user as IUserWithRoles, matchedProjects);
    const authorizedProjectIds = new Set(authorizedProjects.map((project) => project.project_id).filter(Boolean));

    return projectIds.filter((projectId) => authorizedProjectIds.has(projectId));
  });
});

/**
 * Lightweight action that returns all projects with their phases attached.
 * Used by filter pickers that need to display projects + phases as a tree,
 * but don't need the full project details (statuses, users, etc.)
 */
export const getProjectsWithPhases = withAuth(async (
  user,
  { tenant }
): Promise<ProjectWithPhases[] | ActionPermissionError> => {
  try {
    const { knex } = await createTenantKnex();

    const denied = await checkPermission(user, 'project', 'read', knex);
    if (denied) return denied;

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const statusMappingsQuery = tenantScopedTable(trx, 'project_status_mappings as psm', tenant);
      db.tenantJoin(statusMappingsQuery, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
      db.tenantJoin(statusMappingsQuery, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' });
      statusMappingsQuery
        .select(
          'psm.project_status_mapping_id as mapping_id',
          'psm.project_id',
          'psm.phase_id',
          trx.raw("COALESCE(psm.custom_name, s.name, ss.name) as name"),
          trx.raw("COALESCE(s.is_closed, ss.is_closed, false) as is_closed"),
          'psm.display_order'
        )
        .orderBy('psm.display_order');

      const [projects, phases, statusMappings] = await Promise.all([
        tenantScopedTable(trx, 'projects', tenant)
          .select('project_id', 'project_name', 'is_inactive', 'client_id', 'assigned_to')
          .orderBy('project_name'),
        tenantScopedTable(trx, 'project_phases', tenant)
          .select('phase_id', 'project_id', 'phase_name', 'wbs_code')
          .orderBy('wbs_code'),
        // Fetch all project status mappings with resolved names
        statusMappingsQuery,
      ]);

      // Group phases by project
      const phasesByProject = new Map<string, Array<{
        phase_id: string;
        phase_name: string;
        wbs_code: string;
        statuses: ProjectPhaseStatus[];
      }>>();

      // Group status mappings: key = "project_id:phase_id" (phase_id may be null for defaults)
      const statusesByScope = new Map<string, ProjectPhaseStatus[]>();
      for (const m of statusMappings) {
        const key = `${m.project_id}:${m.phase_id || '__default__'}`;
        const list = statusesByScope.get(key) || [];
        list.push({ mapping_id: m.mapping_id, name: m.name, is_closed: !!m.is_closed });
        statusesByScope.set(key, list);
      }

      for (const phase of phases) {
        const list = phasesByProject.get(phase.project_id) || [];
        // Phase-specific statuses, falling back to project defaults
        const phaseStatuses = statusesByScope.get(`${phase.project_id}:${phase.phase_id}`)
          || statusesByScope.get(`${phase.project_id}:__default__`)
          || [];
        list.push({
          phase_id: phase.phase_id,
          phase_name: phase.phase_name,
          wbs_code: phase.wbs_code,
          statuses: phaseStatuses,
        });
        phasesByProject.set(phase.project_id, list);
      }

      const authorizedProjects = await filterAuthorizedProjects(
        trx,
        tenant,
        user as IUserWithRoles,
        projects as Array<Partial<IProject>>
      ) as Array<{
        project_id: string;
        project_name: string;
        is_inactive: boolean;
      }>;

      return authorizedProjects.map((p) => ({
        project_id: p.project_id,
        project_name: p.project_name,
        is_inactive: p.is_inactive,
        phases: phasesByProject.get(p.project_id) || [],
      }));
    });
  } catch (error) {
    console.error('Error fetching projects with phases:', error);
    throw error;
  }
});

export const getProjectPhase = withAuth(async (user, { tenant }, phaseId: string): Promise<IProjectPhase | null> => {
    try {
        const { knex } = await createTenantKnex();
        const phase = await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(user, 'project', 'read', trx)) {
                throw new Error('Permission denied: Cannot read project');
            }
            const projectId = await resolveProjectIdForPhase(trx, tenant, phaseId);
            if (!projectId) {
                return null;
            }
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
            return await ProjectModel.getPhaseById(trx, tenant, phaseId);
        });
        return phase;
    } catch (error) {
        console.error('Error fetching project phase:', error);
        throw error;
    }
});

export const getProjectTreeData = withAuth(async (user, { tenant }, projectId?: string) => {
  try {
    const { knex } = await createTenantKnex();

    const denied = await checkPermission(user, 'project', 'read', knex);
    if (denied) return denied;

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const projects = projectId ?
        [await ProjectModel.getById(trx, tenant, projectId)] :
        await ProjectModel.getAll(trx, tenant, true);

      const validProjects = projects.filter((p): p is NonNullable<typeof p> => p !== null);
      const authorizedProjects = await filterAuthorizedProjects(
        trx,
        tenant,
        user as IUserWithRoles,
        validProjects
      );

      if (authorizedProjects.length === 0) {
        return [];
      }

      const treeData = await Promise.all(authorizedProjects.map(async (project): Promise<{
        label: string;
        value: string;
        type: 'project';
        children: {
          label: string;
          value: string;
          type: 'phase';
          children: {
            label: string;
            value: string;
            type: 'status';
          }[];
        }[];
      } | null> => {
        try {
          const [phases, statusMappings] = await Promise.all([
            ProjectModel.getPhases(trx, tenant, project.project_id),
            ProjectModel.getProjectStatusMappings(trx, tenant, project.project_id)
          ]);

          if (!statusMappings || statusMappings.length === 0) {
            const standardStatuses = await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task');
            await Promise.all(standardStatuses.map((status): Promise<IProjectStatusMapping> =>
              ProjectModel.addProjectStatusMapping(trx, tenant, project.project_id, {
                standard_status_id: status.standard_status_id,
                is_standard: true,
                custom_name: null,
                display_order: status.display_order,
                is_visible: true,
              })
            ));
          }

          // Resolve effective statuses per phase (phase-specific overrides when present,
          // else project-level defaults) so the status IDs surfaced in the tree match the
          // IDs the kanban will render for each phase.
          const phaseStatuses = await Promise.all(
            phases.map((phase) =>
              getProjectTaskStatusesInternal(trx, tenant, project.project_id, user, phase.phase_id)
            )
          );

        return {
          label: project.project_name,
          value: project.project_id,
          type: 'project' as const,
          children: phases.map((phase, phaseIndex): {
            label: string;
            value: string;
            type: 'phase';
            children: {
              label: string;
              value: string;
              type: 'status';
            }[];
          } => ({
            label: phase.phase_name,
            value: phase.phase_id,
            type: 'phase' as const,
            children: phaseStatuses[phaseIndex].map((status): {
                label: string;
                value: string;
                type: 'status';
              } => ({
              label: status.custom_name || status.name,
              value: status.project_status_mapping_id,
              type: 'status' as const
            }))
          }))
        };
      } catch (error) {
        console.error(`Error processing project ${project.project_id}:`, error);
        return null;
      }
    }));

      const validTreeData = treeData
        .filter((data): data is NonNullable<typeof data> =>
          data !== null &&
          data.children &&
          data.children.length > 0
        );

      if (validTreeData.length === 0) {
        return [];
      }

      return validTreeData;
    });
  } catch (error) {
    console.error('Error fetching project tree data:', error);
    throw error;
  }
});

export const updatePhase = withAuth(async (user, { tenant }, phaseId: string, phaseData: Partial<IProjectPhase>): Promise<IProjectPhase | ProjectActionError> => {
    try {
        // Skip validation in development mode since we're handling the types correctly
        const { knex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'update', knex);
        if (denied) return denied;

        const updatedPhase = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const projectId = await resolveProjectIdForPhase(trx, tenant, phaseId);
            if (!projectId) {
                throw new Error('Project phase not found');
            }
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);

            return await ProjectModel.updatePhase(trx, tenant, phaseId, {
                ...phaseData,
                start_date: phaseData.start_date ? new Date(phaseData.start_date) : null,
                end_date: phaseData.end_date ? new Date(phaseData.end_date) : null
            });
        });

        await publishEvent({
            eventType: 'PROJECT_PHASE_UPDATED',
            payload: {
                tenantId: tenant,
                projectId: updatedPhase.project_id,
                phaseId,
                userId: user.user_id,
                timestamp: new Date().toISOString(),
                changes: phaseData as Record<string, unknown>,
            }
        });

        return updatedPhase;
    } catch (error) {
        console.error('Error updating project phase:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const deletePhase = withAuth(async (user, { tenant }, phaseId: string): Promise<void | ProjectActionError> => {
    try {
        const { knex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'delete', knex);
        if (denied) return denied;

        let projectIdForEvent: string | null = null;
        await withTransaction(knex, async (trx: Knex.Transaction) => {
            const projectId = await resolveProjectIdForPhase(trx, tenant, phaseId);
            if (!projectId) {
                throw new Error('Project phase not found');
            }
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
            projectIdForEvent = projectId;
            await ProjectModel.deletePhase(trx, tenant, phaseId);
        });

        if (projectIdForEvent) {
            await publishEvent({
                eventType: 'PROJECT_PHASE_DELETED',
                payload: {
                    tenantId: tenant,
                    projectId: projectIdForEvent,
                    phaseId,
                    userId: user.user_id,
                    timestamp: new Date().toISOString(),
                }
            });
        }
    } catch (error) {
        console.error('Error deleting project phase:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const addProjectPhase = withAuth(async (user, { tenant }, phaseData: Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>): Promise<IProjectPhase | ProjectActionError> => {
    try {
        const validatedData = validateData(projectPhaseSchema.omit({
            phase_id: true,
            created_at: true,
            updated_at: true,
            tenant: true
        }), phaseData);

        // Get the project first to get its WBS code
        const { knex } = await createTenantKnex();

        const denied = await checkPermission(user, 'project', 'update', knex);
        if (denied) return denied;

        const createdPhase = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const project = await ProjectModel.getById(trx, tenant, phaseData.project_id);
            if (!project) {
                throw new Error('Project not found');
            }
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, project.project_id);

            const phases = await ProjectModel.getPhases(trx, tenant, phaseData.project_id);
            const nextOrderNumber = phases.length + 1;

            // Get next phase number
            const phaseNumbers = phases
                .map((phase):number => {
                    const parts = phase.wbs_code.split('.');
                    return parseInt(parts[parts.length - 1]);
                })
                .filter(num => !isNaN(num));

            const maxPhaseNumber = phaseNumbers.length > 0 ? Math.max(...phaseNumbers) : 0;
            const newWbsCode = `${project.wbs_code}.${maxPhaseNumber + 1}`;

            // Generate order key for the new phase
            const { generateKeyBetween } = await import('fractional-indexing');
            let orderKey: string;

            if (phases.length === 0) {
                // First phase
                orderKey = generateKeyBetween(null, null);
            } else {
                // Add after the last phase
                const sortedPhases = [...phases].sort((a, b) => {
                    if (a.order_key && b.order_key) {
                        return a.order_key < b.order_key ? -1 : a.order_key > b.order_key ? 1 : 0;
                    }
                    return 0;
                });
                const lastPhase = sortedPhases[sortedPhases.length - 1];
                orderKey = generateKeyBetween(lastPhase.order_key || null, null);
            }

            const phaseWithDefaults = {
                ...validatedData,
                order_number: nextOrderNumber,
                wbs_code: newWbsCode,
                order_key: orderKey,
            };

            return await ProjectModel.addPhase(trx, tenant, phaseWithDefaults as Omit<IProjectPhase, 'phase_id' | 'created_at' | 'updated_at' | 'tenant'>);
        });

        await publishEvent({
            eventType: 'PROJECT_PHASE_CREATED',
            payload: {
                tenantId: tenant,
                projectId: createdPhase.project_id,
                phaseId: createdPhase.phase_id,
                userId: user.user_id,
                timestamp: new Date().toISOString(),
            }
        });

        return createdPhase;
    } catch (error) {
        console.error('Error adding project phase:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const reorderPhase = withAuth(async (user, { tenant }, phaseId: string, beforePhaseId?: string | null, afterPhaseId?: string | null): Promise<void | ProjectActionError> => {
    try {
    const { knex: db } = await createTenantKnex();

    const denied = await checkPermission(user, 'project', 'update', db);
    if (denied) return denied;

    await withTransaction(db, async (trx: Knex.Transaction) => {
        // Get the phase being moved
        const phase = await tenantScopedTable(trx, 'project_phases', tenant)
            .where({ phase_id: phaseId })
            .select('project_id')
            .first();

        if (!phase) {
            throw new Error('Phase not found');
        }
        await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, phase.project_id);

        // Get order keys for positioning
        let beforeKey: string | null = null;
        let afterKey: string | null = null;

        if (beforePhaseId) {
            const beforePhase = await tenantScopedTable(trx, 'project_phases', tenant)
                .where({ phase_id: beforePhaseId })
                .select('order_key')
                .first();
            beforeKey = beforePhase?.order_key || null;
        }

        if (afterPhaseId) {
            const afterPhase = await tenantScopedTable(trx, 'project_phases', tenant)
                .where({ phase_id: afterPhaseId })
                .select('order_key')
                .first();
            afterKey = afterPhase?.order_key || null;
        }

        try {
            // Use OrderingService for key generation
            const newOrderKey = OrderingService.generateKeyForPosition(beforeKey, afterKey);

            await tenantScopedTable(trx, 'project_phases', tenant)
                .where({ phase_id: phaseId })
                .update({
                    order_key: newOrderKey,
                    updated_at: trx.fn.now()
                });

            console.log('Phase reordered successfully:', {
                phaseId,
                newOrderKey,
                beforeKey,
                afterKey
            });
        } catch (error) {
            console.error('Error generating order key for phase:', error);

            // Try to recover by regenerating all order keys for the project
            const { isProjectOrderKeyActionError, regenerateOrderKeysForPhases } = await import('./regenerateOrderKeys');
            const regenerationResult = await regenerateOrderKeysForPhases(phase.project_id);
            if (isProjectOrderKeyActionError(regenerationResult)) {
                throw regenerationResult;
            }

            // Try again with fresh order keys
            const freshBeforePhase = beforePhaseId ? await tenantScopedTable(trx, 'project_phases', tenant)
                .where({ phase_id: beforePhaseId })
                .select('order_key')
                .first() : null;
            const freshAfterPhase = afterPhaseId ? await tenantScopedTable(trx, 'project_phases', tenant)
                .where({ phase_id: afterPhaseId })
                .select('order_key')
                .first() : null;

            const freshBeforeKey = freshBeforePhase?.order_key || null;
            const freshAfterKey = freshAfterPhase?.order_key || null;

            const newOrderKey = OrderingService.generateKeyForPosition(freshBeforeKey, freshAfterKey);

            await tenantScopedTable(trx, 'project_phases', tenant)
                .where({ phase_id: phaseId })
                .update({
                    order_key: newOrderKey,
                    updated_at: trx.fn.now()
                });

            console.log('Phase reordered successfully after recovery:', {
                phaseId,
                newOrderKey
            });
        }
    });
    } catch (error) {
        console.error('Error reordering project phase:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const getProject = withAuth(async (user, { tenant }, projectId: string): Promise<IProject | null | ActionPermissionError> => {
    try {
        const { knex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'read', knex);
        if (denied) return denied;

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            const project = await ProjectModel.getById(trx, tenant, projectId);
            if (!project) {
                return null;
            }

            const authorizedProjects = await filterAuthorizedProjects(trx, tenant, user as IUserWithRoles, [project]);
            return authorizedProjects[0] ?? null;
        });
    } catch (error) {
        console.error('Error fetching project:', error);
        throw error;
    }
});

// Internal function for getting statuses within transaction
async function getStandardProjectTaskStatusesInternal(trx: Knex.Transaction, tenant: string): Promise<IStandardStatus[]> {
    return await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task');
}

export const getProjectStatuses = withAuth(async (user, { tenant }): Promise<IStatus[] | ActionPermissionError> => {
  try {
    const { knex } = await createTenantKnex();
    const denied = await checkPermission(user, 'project', 'read', knex);
    if (denied) return denied;

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await ProjectModel.getStatusesByType(trx, tenant, 'project');
    });
  } catch (error) {
    console.error('Error fetching project statuses:', error);
    throw error;
  }
});

export const generateNextWbsCode = withAuth(async (user, { tenant }): Promise<string | ActionPermissionError> => {
    try {
        const { knex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'read', knex);
        if (denied) return denied;

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await ProjectModel.generateNextWbsCode(trx, tenant, '');
        });
    } catch (error) {
        console.error('Error generating WBS code:', error);
        throw error;
    }
});

export const createProject = withAuth(async (
  user,
  { tenant },
  projectData: Omit<IProject, 'project_id' | 'created_at' | 'updated_at' | 'wbs_code' | 'project_number'> & {
    assigned_to?: string | null;
    contact_name_id?: string | null;
  },
  selectedTaskStatusIds?: string[],
  options?: {
    /** Optional transaction to use - if provided, the project will be created within this transaction */
    trx?: Knex.Transaction;
    /** If true, skip publishing events (useful when called within another action's transaction) */
    skipEvents?: boolean;
  }
): Promise<IProject | ActionPermissionError | ActionMessageError> => {
    try {
        const { knex: permKnex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'create', permKnex);
        if (denied) return denied;

        // Get project statuses first
        const projectStatuses = await getProjectStatusesInternal(tenant, user);

        if (projectStatuses.length === 0) {
            return actionError('Project statuses are not configured. Add at least one project status before creating projects.');
        }

        const { knex } = await createTenantKnex();
        const externalTrx = options?.trx;

        // Try to get both standard statuses and regular statuses for backward compatibility
        const getStatuses = async (trx: Knex.Transaction) => {
            const standardStatuses = await ProjectModel.getStandardStatusesByType(trx, tenant, 'project_task').catch(() => []);
            const regularStatuses = await ProjectModel.getStatusesByType(trx, tenant, 'project_task').catch(() => []);
            return [standardStatuses, regularStatuses] as const;
        };

        const [standardTaskStatuses, projectTaskStatuses] = externalTrx
            ? await getStatuses(externalTrx)
            : await withTransaction(knex, getStatuses);

        // Prefer regular statuses (new system with colors/icons) over standard statuses (old system)
        const taskStatusesToUse = projectTaskStatuses.length > 0 ? projectTaskStatuses : standardTaskStatuses;

        console.log(`[createProject] Found ${projectTaskStatuses.length} custom statuses and ${standardTaskStatuses.length} standard statuses`);
        console.log(`[createProject] Using ${taskStatusesToUse.length} statuses, isStandard: ${projectTaskStatuses.length === 0}`);
        console.log(`[createProject] selectedTaskStatusIds:`, selectedTaskStatusIds);

        if (taskStatusesToUse.length === 0) {
            return actionError('Project task statuses are not configured. Add at least one task status before creating projects.');
        }

        const validatedData = validateData(createProjectSchema, projectData);

        // Helper function for the actual project creation logic
        const createProjectInTransaction = async (trx: Knex.Transaction) => {
            // Permission already checked before transaction

            // Generate project number
            const projectNumber = await SharedNumberingService.getNextNumber(
                'PROJECT',
                { knex: trx, tenant }
            );
            console.log(`[createProject] Generated project number: ${projectNumber}`);

            const wbsCode = await ProjectModel.generateNextWbsCode(trx, tenant, '');
            // Remove tenant field if present in validatedData
            const { tenant: _, ...safeValidatedData } = validatedData;
            // Use the status the user selected; fall back to first available status
            const selectedStatus = projectStatuses.find(s => s.status_id === safeValidatedData.status) ?? projectStatuses[0];
            const projectDataWithStatus = {
                ...safeValidatedData,
                status: selectedStatus.status_id,
                status_name: selectedStatus.name,
                is_closed: selectedStatus.is_closed,
                assigned_to: safeValidatedData.assigned_to || null,
                contact_name_id: safeValidatedData.contact_name_id || null,
                wbs_code: wbsCode,
                project_number: projectNumber
            };
            console.log('Project data with status:', projectDataWithStatus); // Debug log

            // Add debug logging before database insert
            console.log('Creating project with data:', projectDataWithStatus);

            const newProject = await ProjectModel.create(trx, tenant, {
                ...projectDataWithStatus,
                assigned_to: validatedData.assigned_to || null,
                contact_name_id: validatedData.contact_name_id || null
            } as Omit<IProject, 'project_id' | 'created_at' | 'updated_at' | 'tenant'>);

            // Create project status mappings - handle both standard and regular statuses
            const isUsingStandardStatuses = projectTaskStatuses.length === 0;

            console.log(`[createProject] isUsingStandardStatuses: ${isUsingStandardStatuses}`);

            // Filter and order statuses based on selection (if provided)
            let statusesToCreate: Array<IStandardStatus | IStatus>;

            if (selectedTaskStatusIds && selectedTaskStatusIds.length > 0) {
                // Create ordered list based on selectedTaskStatusIds array order
                statusesToCreate = selectedTaskStatusIds
                    .map(statusId => {
                        return taskStatusesToUse.find(status => {
                            const id = isUsingStandardStatuses
                                ? (status as IStandardStatus).standard_status_id
                                : (status as IStatus).status_id;
                            return id === statusId;
                        });
                    })
                    .filter((status): status is IStandardStatus | IStatus => status !== undefined);
            } else {
                // If no selection, use all statuses (backward compatibility)
                statusesToCreate = taskStatusesToUse;
            }

            console.log(`[createProject] Creating ${statusesToCreate.length} status mappings`);

            // Create mappings in the specified order
            for (let i = 0; i < statusesToCreate.length; i++) {
                const status = statusesToCreate[i];
                const displayOrder = i + 1; // Use index for display_order to maintain user's chosen order

                if (isUsingStandardStatuses) {
                    // Using standard_statuses table (backward compatibility)
                    await ProjectModel.addProjectStatusMapping(trx, tenant, newProject.project_id, {
                        standard_status_id: (status as IStandardStatus).standard_status_id,
                        is_standard: true,
                        custom_name: null,
                        display_order: displayOrder,
                        is_visible: true,
                    });
                } else {
                    // Using regular statuses table (new approach)
                    await ProjectModel.addProjectStatusMapping(trx, tenant, newProject.project_id, {
                        status_id: (status as IStatus).status_id,
                        is_standard: false,
                        custom_name: null, // Name comes from join with statuses table
                        display_order: displayOrder,
                        is_visible: true,
                    });
                }
            }

            // Fetch the full project details including contact and assigned user
            const project = await ProjectModel.getById(trx, tenant, newProject.project_id);
            if (!project) {
                throw new Error('Created project could not be reloaded after insert.');
            }
            return project;
        };

        // Execute using external transaction if provided, otherwise create a new one
        const fullProject = externalTrx
            ? await createProjectInTransaction(externalTrx)
            : await withTransaction(knex, createProjectInTransaction);

        // Only publish events if not using an external transaction (or explicitly requested)
        if (!options?.skipEvents) {
            // Publish project created event
            await publishEvent({
                eventType: 'PROJECT_CREATED',
                payload: {
                    tenantId: tenant,
                    projectId: fullProject.project_id,
                    userId: user.user_id,
                    timestamp: new Date().toISOString()
                }
            });
        }

        return fullProject;
    } catch (error) {
        console.error('Error creating project:', error);
        if (error instanceof Error && error.message === 'Failed to fetch created project details') {
            return actionError('Project could not be created because its details could not be loaded. Please try again.');
        }
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

// Internal helper to get project statuses
async function getProjectStatusesInternal(tenant: string, user: IUser): Promise<IStatus[]> {
    const { knex } = await createTenantKnex();
    const hasRead = await hasPermission(user, 'project', 'read', knex);
    if (!hasRead) {
        throw new Error('Permission denied: Cannot read project');
    }
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await ProjectModel.getStatusesByType(trx, tenant, 'project');
    });
}

export const updateProject = withAuth(async (user, { tenant }, projectId: string, projectData: Partial<IProject>): Promise<IProject | ProjectActionError> => {
    try {
        // Remove tenant field if present in projectData
        const { tenant: tenantField, ...safeProjectData } = projectData;
        const validatedData = validateData(updateProjectSchema, safeProjectData);

        const { knex } = await createTenantKnex();

        const denied = await checkPermission(user, 'project', 'update', knex);
        if (denied) return denied;

        const { beforeProject, updatedProject } = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const beforeProject = await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
            let project = await ProjectModel.update(trx, tenant, projectId, validatedData);

            // If status was updated, fetch the status details
            if ('status' in safeProjectData && safeProjectData.status) {
                const status = await ProjectModel.getCustomStatus(trx, tenant, safeProjectData.status);
                if (status) {
                    project = await ProjectModel.update(trx, tenant, projectId, {
                        ...project,
                        status_name: status.name,
                        is_closed: status.is_closed
                    });
                }
            }
            return { beforeProject, updatedProject: project };
        });

        // If assigned_to was updated, fetch the full user details and publish event
        if ('assigned_to' in projectData && projectData.assigned_to !== updatedProject.assigned_to) {
            if (updatedProject.assigned_to) {
                const assignedUser = await findUserById(updatedProject.assigned_to);
                updatedProject.assigned_user = assignedUser || null;

                // Publish project assigned event only if assigned_to actually changed
                await publishEvent({
                    eventType: 'PROJECT_ASSIGNED',
                    payload: {
                        tenantId: tenant,
                        projectId: projectId,
                        userId: user.user_id,
                        assignedTo: updatedProject.assigned_to,
                        timestamp: new Date().toISOString()
                    }
                });
            } else {
                updatedProject.assigned_user = null;
            }
        }

        // If contact_name_id was updated, fetch the full contact details
        if ('contact_name_id' in projectData) {
            if (updatedProject.contact_name_id) {
                const fullName = await getContactFullNameByContactNameId({
                    knexOrTrx: knex,
                    tenant,
                    contactNameId: updatedProject.contact_name_id,
                });
                updatedProject.contact_name = fullName;
            } else {
                updatedProject.contact_name = null;
            }
        }

        const occurredAt = updatedProject.updated_at instanceof Date ? updatedProject.updated_at : new Date();
        const ctx = {
            tenantId: tenant,
            occurredAt,
            actor: { actorType: 'USER' as const, actorUserId: user.user_id },
        };

        if ('status' in validatedData && beforeProject.status !== updatedProject.status) {
            await publishWorkflowEvent({
                eventType: 'PROJECT_STATUS_CHANGED',
                ctx,
                payload: buildProjectStatusChangedPayload({
                    projectId,
                    previousStatus: beforeProject.status,
                    newStatus: updatedProject.status,
                    changedAt: occurredAt,
                }),
            });
        }

        await publishWorkflowEvent({
            eventType: 'PROJECT_UPDATED',
            ctx,
            payload: buildProjectUpdatedPayload({
                projectId,
                before: beforeProject as unknown as Record<string, unknown> & { project_id: string },
                after: updatedProject as unknown as Record<string, unknown> & { project_id: string },
                updatedFieldKeys: Object.keys(validatedData),
                updatedAt: occurredAt,
            }),
        });

        return updatedProject;
    } catch (error) {
        console.error('Error updating project:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const deleteProject = withAuth(async (
    user,
    { tenant },
    projectId: string
): Promise<(DeletionValidationResult & { success: boolean; deleted?: boolean }) | ActionPermissionError> => {
    try {
        const { knex } = await createTenantKnex();

        const denied = await checkPermission(user, 'project', 'delete', knex);
        if (denied) return denied;

        const result = await deleteEntityWithValidation('project', projectId, knex, tenant, async (trx, tenantId) => {
            await assertProjectReadAllowed(trx as Knex.Transaction, tenantId, user as IUserWithRoles, projectId);

            await deleteEntityTags(trx, projectId, 'project');

            const phaseIds = await tenantScopedTable(trx as Knex.Transaction, 'project_phases', tenantId)
                .where({ project_id: projectId })
                .pluck('phase_id');

            if (phaseIds.length > 0) {
                const taskIds = await tenantScopedTable(trx as Knex.Transaction, 'project_tasks', tenantId)
                    .whereIn('phase_id', phaseIds)
                    .pluck('task_id');

                if (taskIds.length > 0) {
                    await deleteEntitiesTags(trx, taskIds, 'project_task');
                }
            }

            // Clean up child records owned by the project
            await tenantScopedTable(trx as Knex.Transaction, 'project_ticket_links', tenantId).where({ project_id: projectId }).delete();
            await tenantScopedTable(trx as Knex.Transaction, 'email_reply_tokens', tenantId).where({ project_id: projectId }).delete();

            // Drop every user's per-project "hidden kanban columns" preference for
            // this project — those rows reference this project by setting name and
            // would otherwise be orphaned once the project is gone.
            await tenantScopedTable(trx as Knex.Transaction, 'user_preferences', tenantId)
                .where({ setting_name: projectKanbanHiddenStatusesKey(projectId) })
                .delete();

            await ProjectModel.delete(trx, tenantId, projectId);
        });

        const response = {
            ...result,
            success: result.deleted === true,
            deleted: result.deleted
        };

        if (response.success) {
            await publishEvent({
                eventType: 'PROJECT_DELETED',
                payload: {
                    tenantId: tenant,
                    projectId,
                    userId: user.user_id,
                    timestamp: new Date().toISOString(),
                }
            });
        }

        return response;
    } catch (error) {
        console.error('Error deleting project:', error);
        return {
            success: false,
            canDelete: false,
            code: 'VALIDATION_FAILED',
            message: projectDeleteErrorMessage(error),
            dependencies: [],
            alternatives: []
        };
    }
});

export const getProjectMetadata = withAuth(async (user, { tenant }, projectId: string): Promise<ProjectActionError | {
    project: IProject;
    phases: IProjectPhase[];
    statuses: ProjectStatus[];
    users: IUserWithRoles[];
    contact?: { full_name: string };
    assignedUser: IUserWithRoles | null;
    clients: IClient[];
}> => {
    try {
        const { knex } = await createTenantKnex();

        const denied = await checkPermission(user, 'project', 'read', knex);
        if (denied) return denied;

        await withTransaction(knex, async (trx: Knex.Transaction) => {
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
        });

        // Fetch data that doesn't need to be in a transaction
        const [statuses, users, clients] = await Promise.all([
            getProjectTaskStatusesInternal2(tenant, projectId, user),
            getAllUsers(),
            getAllClientsForProjectsInternal(tenant)
        ]);

        // Fetch project-specific data within a transaction
        const projectData = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const [project, phases] = await Promise.all([
                ProjectModel.getById(trx, tenant, projectId),
                ProjectModel.getPhases(trx, tenant, projectId)
            ]);

            return { project, phases };
        });

        const { project, phases } = projectData;
        if (!project) {
            throw new Error('Project not found');
        }

        // Fetch assigned user details if assigned_to exists
        let assignedUser: IUserWithRoles | null = null;
        if (project.assigned_to) {
            const foundUser = await findUserById(project.assigned_to);
            assignedUser = foundUser || null;
        }

        // Fetch contact details if needed
        let contact: { full_name: string } | undefined;
        if (project.contact_name_id) {
            const contactData = await withTransaction(knex, async (trx: Knex.Transaction) => {
                return await tenantDb(trx, tenant).table('contacts')
                    .where({ contact_name_id: project.contact_name_id })
                    .select('full_name')
                    .first();
            });
            contact = contactData;
        }

        return {
            project,
            phases,
            statuses,
            users,
            contact,
            assignedUser,
            clients
        };
    } catch (error) {
        console.error('Error getting project metadata:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

// Internal helper for getAllClientsForProjects
async function getAllClientsForProjectsInternal(tenant: string): Promise<IClient[]> {
    const { knex: db } = await createTenantKnex();
    const clients = await withTransaction(db, async (trx: Knex.Transaction) => {
        return tenantScopedTable(trx, 'clients', tenant).select('*').orderBy('client_name', 'asc');
    });
    return clients as IClient[];
}

// Internal helper for getProjectTaskStatuses
async function getProjectTaskStatusesInternal2(
    tenant: string,
    projectId: string,
    user: IUser,
    phaseId?: string | null
): Promise<ProjectStatus[]> {
    const { knex } = await createTenantKnex();
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await getProjectTaskStatusesInternal(trx, tenant, projectId, user, phaseId);
    });
}

// Internal function to get project task statuses within transaction
async function getProjectTaskStatusesInternal(
    trx: Knex.Transaction,
    tenant: string,
    projectId: string,
    user: IUser,
    phaseId?: string | null
): Promise<ProjectStatus[]> {
    if (!await hasPermission(user, 'project', 'read', trx)) {
        throw new Error('Permission denied: Cannot read project');
    }
    await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
    return resolvePhaseStatusesInternal(trx, tenant, projectId, phaseId);
}

// Resolve the effective statuses for a single phase (or the project defaults
// when phaseId is null). The caller is responsible for having verified read
// permission on the project within `trx`, so this can be looped over many
// phases inside a single transaction without repeating the permission checks.
async function resolvePhaseStatusesInternal(
    trx: Knex.Transaction,
    tenant: string,
    projectId: string,
    phaseId?: string | null
): Promise<ProjectStatus[]> {
    const statusMappings = await ProjectModel.getEffectiveStatusMappings(trx, tenant, projectId, phaseId);
    if (!statusMappings || statusMappings.length === 0) {
        console.warn(`No status mappings found for project ${projectId}`);
        return [];
    }

    const { standardMap, customMap } = await fetchStatusesForMappings(trx, tenant, statusMappings);
    return mapStatusMappingsToStatuses(statusMappings, standardMap, customMap);
}

// Batch-fetch the standard and custom status rows referenced by a set of
// mappings in 2 queries (one per status table) instead of 1 per mapping.
async function fetchStatusesForMappings(
    trx: Knex.Transaction,
    tenant: string,
    mappings: IProjectStatusMapping[]
): Promise<{ standardMap: Map<string, IStandardStatus>; customMap: Map<string, IStatus> }> {
    // De-dupe ids: when multiple phases fall back to the same default mappings
    // the same status can appear many times across the merged mapping list.
    const standardIds = [...new Set(
        mappings.filter(m => m.is_standard && m.standard_status_id).map(m => m.standard_status_id!)
    )];
    const customIds = [...new Set(
        mappings.filter(m => !m.is_standard && m.status_id).map(m => m.status_id!)
    )];

    const [standardStatusRows, customStatusRows] = await Promise.all([
        standardIds.length > 0
            ? tenantDb(trx, tenant).table<IStandardStatus>('standard_statuses').whereIn('standard_status_id', standardIds)
            : [],
        customIds.length > 0
            ? tenantScopedTable(trx, 'statuses', tenant).whereIn('status_id', customIds)
            : []
    ]);

    return {
        standardMap: new Map((standardStatusRows as IStandardStatus[]).map(s => [s.standard_status_id, s])),
        customMap: new Map((customStatusRows as IStatus[]).map(s => [s.status_id, s])),
    };
}

// Transform status mappings into resolved ProjectStatus rows using pre-fetched
// status lookups. Pure (no I/O), so it can resolve many phases from one batch.
function mapStatusMappingsToStatuses(
    statusMappings: IProjectStatusMapping[],
    standardMap: Map<string, IStandardStatus>,
    customMap: Map<string, IStatus>
): ProjectStatus[] {
    const statuses = statusMappings.map((mapping: IProjectStatusMapping): ProjectStatus | null => {
        if (mapping.is_standard && mapping.standard_status_id) {
            const standardStatus = standardMap.get(mapping.standard_status_id);
            if (!standardStatus) {
                console.warn(`Standard status not found for mapping ${mapping.project_status_mapping_id}`);
                return null;
            }
            return {
                ...standardStatus,
                project_status_mapping_id: mapping.project_status_mapping_id,
                status_id: standardStatus.standard_status_id,
                phase_id: mapping.phase_id,
                custom_name: mapping.custom_name,
                display_order: mapping.display_order,
                is_visible: mapping.is_visible,
                is_standard: true,
                is_closed: standardStatus.is_closed
            } as ProjectStatus;
        } else if (mapping.status_id) {
            const customStatus = customMap.get(mapping.status_id);
            if (!customStatus) {
                console.warn(`Custom status not found for mapping ${mapping.project_status_mapping_id}`);
                return null;
            }
            return {
                ...customStatus,
                project_status_mapping_id: mapping.project_status_mapping_id,
                status_id: customStatus.status_id,
                phase_id: mapping.phase_id,
                custom_name: mapping.custom_name,
                display_order: mapping.display_order,
                is_visible: mapping.is_visible,
                is_standard: false,
                is_closed: customStatus.is_closed,
                color: customStatus.color,
                icon: customStatus.icon
            } as ProjectStatus;
        }
        console.warn(`Invalid status mapping ${mapping.project_status_mapping_id}: missing both standard_status_id and status_id`);
        return null;
    });

    return statuses.filter((status): status is ProjectStatus => status !== null);
}

export const getProjectDetails = withAuth(async (user, { tenant }, projectId: string): Promise<ProjectActionError | {
    project: IProject;
    phases: IProjectPhase[];
    tasks: IProjectTask[];
    ticketLinks: IProjectTicketLinkWithDetails[];
    statuses: ProjectStatus[];
    users: IUserWithRoles[];
    contact?: { full_name: string };
    assignedUser: IUserWithRoles | null;
    clients: IClient[];
}> => {
    try {
        const { knex } = await createTenantKnex();

        const denied = await checkPermission(user, 'project', 'read', knex);
        if (denied) return denied;

        await withTransaction(knex, async (trx: Knex.Transaction) => {
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
        });

        // Fetch data that doesn't need to be in a transaction
        const [statuses, users, clients] = await Promise.all([
            getProjectTaskStatusesInternal2(tenant, projectId, user),
            getAllUsers(),
            getAllClientsForProjectsInternal(tenant)
        ]);

        // Fetch project-specific data within a transaction
        const projectData = await withTransaction(knex, async (trx: Knex.Transaction) => {
            const [project, phases, rawTasks, checklistItemsMap, ticketLinksMap, taskResourcesMap] = await Promise.all([
                ProjectModel.getById(trx, tenant, projectId),
                ProjectModel.getPhases(trx, tenant, projectId),
                ProjectTaskModel.getTasks(trx, tenant, projectId),
                ProjectTaskModel.getAllTaskChecklistItems(trx, tenant, projectId),
                ProjectTaskModel.getAllTaskTicketLinks(trx, tenant, projectId),
                ProjectTaskModel.getAllTaskResources(trx, tenant, projectId)
            ]);

            return { project, phases, rawTasks, checklistItemsMap, ticketLinksMap, taskResourcesMap };
        });

        const { project, phases, rawTasks, checklistItemsMap, ticketLinksMap, taskResourcesMap } = projectData;

        if (!project) {
            throw new Error('Project not found');
        }

        // Fetch assigned user details if assigned_to exists
        if (project.assigned_to) {
            const assignedUser = await findUserById(project.assigned_to);
            project.assigned_user = assignedUser || null;
        }

        const tasks = rawTasks.map((task): IProjectTask & {
            checklist_items: ITaskChecklistItem[],
            resources: any[]
        } => ({
            ...task,
            checklist_items: checklistItemsMap[task.task_id] || [],
            resources: taskResourcesMap[task.task_id] || []
        }));

        const ticketLinks = Object.values(ticketLinksMap).flat();
        const allowedTicketIds = await withTransaction(knex, async (trx: Knex.Transaction) =>
            filterAuthorizedTicketIds(
                trx,
                tenant,
                user as IUserWithRoles,
                ticketLinks.map((link) => link.ticket_id)
            )
        );
        const authorizedTicketLinks = ticketLinks.map((link) => applyTicketLinkRestriction(link, allowedTicketIds));

        const contact = project.contact_name ? {
            full_name: project.contact_name
        } : undefined;

        return {
            project,
            phases,
            tasks,
            ticketLinks: authorizedTicketLinks,
            statuses,
            users,
            contact,
            assignedUser: project.assigned_user || null,
            clients
        };
    } catch (error) {
        console.error('Error fetching project details:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const updateProjectStructure = withAuth(async (user, { tenant }, projectId: string, updates: { phases: Partial<IProjectPhase>[]; tasks: Partial<IProjectTask>[] }): Promise<void | ProjectActionError> => {
    try {
        const { knex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'update', knex);
        if (denied) return denied;

        await withTransaction(knex, async (trx: Knex.Transaction) => {
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
            await ProjectModel.updateStructure(trx, tenant, projectId, updates);
        });
    } catch (error) {
        console.error('Error updating project structure:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const getProjectTaskStatuses = withAuth(async (
    user,
    { tenant },
    projectId: string,
    phaseId?: string | null
): Promise<ProjectStatus[]> => {
    try {
        const { knex } = await createTenantKnex();

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
            return await getProjectTaskStatusesInternal(trx, tenant, projectId, user, phaseId);
        });
    } catch (error) {
        console.error('Error fetching project statuses:', error);
        return [];
    }
});

/**
 * Resolve the effective status mappings for every phase in a project, keyed by
 * phase_id. The list view renders all phases at once, and status mapping IDs are
 * per-phase (a phase either has its own mappings or falls back to the project
 * defaults), so a single phase's statuses cannot bucket tasks from other phases.
 */
export const getProjectStatusesByPhase = withAuth(async (
    user,
    { tenant },
    projectId: string
): Promise<Record<string, ProjectStatus[]> | ProjectActionError> => {
    try {
        const { knex } = await createTenantKnex();

        // Resolve every phase's statuses inside a single transaction, verifying
        // access once. The actual resolution batches all phases into 3 queries
        // total (see resolveAllPhaseStatusesInternal) rather than querying per
        // phase, which previously also opened a transaction per phase.
        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            if (!await hasPermission(user, 'project', 'read', trx)) {
                throw new Error('Permission denied: Cannot read project');
            }
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);

            const phases = await ProjectModel.getPhases(trx, tenant, projectId);
            return resolveAllPhaseStatusesInternal(trx, tenant, projectId, phases);
        });
    } catch (error) {
        console.error('Error fetching project statuses by phase:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

// Resolve the effective statuses for every phase in 3 queries total, regardless
// of phase count: one query for all of the project's status mappings (phase
// rows + the phase_id IS NULL defaults), grouped by phase in memory, then two
// queries to resolve every referenced standard/custom status. This replaces the
// per-phase query fan-out of looping resolvePhaseStatusesInternal.
async function resolveAllPhaseStatusesInternal(
    trx: Knex.Transaction,
    tenant: string,
    projectId: string,
    phases: IProjectPhase[]
): Promise<Record<string, ProjectStatus[]>> {
    const allMappings = await tenantScopedTable(trx, 'project_status_mappings', tenant)
        .where('project_id', projectId)
        .orderBy('display_order') as IProjectStatusMapping[];

    // Split into per-phase groups and the project-level defaults (phase_id null).
    // Iteration order follows the display_order sort, so each group stays ordered.
    const defaultMappings: IProjectStatusMapping[] = [];
    const mappingsByPhase = new Map<string, IProjectStatusMapping[]>();
    for (const mapping of allMappings) {
        if (mapping.phase_id) {
            const list = mappingsByPhase.get(mapping.phase_id);
            if (list) {
                list.push(mapping);
            } else {
                mappingsByPhase.set(mapping.phase_id, [mapping]);
            }
        } else {
            defaultMappings.push(mapping);
        }
    }

    // A phase uses its own mappings when present, otherwise the project defaults
    // — mirroring ProjectModel.getEffectiveStatusMappings, but without a query.
    const effectiveByPhase = new Map<string, IProjectStatusMapping[]>();
    for (const phase of phases) {
        const own = mappingsByPhase.get(phase.phase_id);
        effectiveByPhase.set(phase.phase_id, own && own.length > 0 ? own : defaultMappings);
    }

    // Resolve every referenced status across all phases in 2 queries.
    const effectiveMappings = Array.from(effectiveByPhase.values()).flat();
    const { standardMap, customMap } = await fetchStatusesForMappings(trx, tenant, effectiveMappings);

    const result: Record<string, ProjectStatus[]> = {};
    for (const phase of phases) {
        const mappings = effectiveByPhase.get(phase.phase_id) ?? [];
        result[phase.phase_id] = mapStatusMappingsToStatuses(mappings, standardMap, customMap);
    }
    return result;
}

export const addStatusToProject = withAuth(async (user, { tenant }, projectId: string, statusData: Omit<IStatus, 'status_id' | 'created_at' | 'updated_at'>): Promise<IStatus | ProjectActionError> => {
    try {
        const { knex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'update', knex);
        if (denied) return denied;

        return await withTransaction(knex, async (trx: Knex.Transaction) => {
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);
            return await ProjectModel.addStatusToProject(trx, tenant, projectId, statusData);
        });
    } catch (error) {
        console.error('Error adding status to task:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const updateProjectStatus = withAuth(async (
    user,
    { tenant },
    projectId: string,
    statusId: string,
    statusData: Partial<IStatus>,
    mappingData: Partial<IProjectStatusMapping>
): Promise<IStatus | ProjectActionError> => {
    try {
        const { knex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'update', knex);
        if (denied) return denied;

        const updatedStatus = await withTransaction(knex, async (trx: Knex.Transaction) => {
            await assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId);

            const relatedProjectIds = await resolveProjectIdsForStatus(trx, tenant, statusId);
            if (relatedProjectIds.length > 0) {
                await Promise.all(
                    relatedProjectIds.map((relatedProjectId) =>
                        assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, relatedProjectId)
                    )
                );
            }

            return await ProjectModel.updateProjectStatus(trx, tenant, statusId, statusData, mappingData);
        });

        // If the status is closed, publish project closed event
        if (statusData.is_closed) {
            await publishEvent({
                eventType: 'PROJECT_CLOSED',
                payload: {
                    tenantId: tenant,
                    projectId: projectId,
                    userId: user.user_id,
                    changes: statusData
                }
            });
        }

        return updatedStatus;
    } catch (error) {
        console.error('Error updating project status:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});

export const deleteProjectStatus = withAuth(async (user, { tenant }, statusId: string): Promise<void | ProjectActionError> => {
    try {
        const { knex } = await createTenantKnex();
        const denied = await checkPermission(user, 'project', 'delete', knex);
        if (denied) return denied;

        await withTransaction(knex, async (trx: Knex.Transaction) => {
            const projectIds = await resolveProjectIdsForStatus(trx, tenant, statusId);
            if (projectIds.length > 0) {
                await Promise.all(
                    projectIds.map((projectId) =>
                        assertProjectReadAllowed(trx, tenant, user as IUserWithRoles, projectId)
                    )
                );
            }
            await ProjectModel.deleteProjectStatus(trx, tenant, statusId);
        });
    } catch (error) {
        console.error('Error deleting project status:', error);
        const expected = projectActionErrorFrom(error);
        if (expected) {
            return expected;
        }
        throw error;
    }
});
