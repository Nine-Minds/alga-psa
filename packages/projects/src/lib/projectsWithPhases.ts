import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { IProject, IUser, IUserWithRoles, ProjectPhaseStatus, ProjectWithPhases } from '@alga-psa/types';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { createProjectReadDecider } from './projectReadAuthorization';
import { projectReadableRecord } from '@alga-psa/authorization/recordProjection';

// Plain (non-'use server') helpers behind the project read actions. They are not server actions
// themselves, so nothing here is callable from the browser: a caller supplies the authenticated
// user and tenant, as the withAuth wrappers do.

// A frame plus the raw resource and action does not translate, so the pairs the
// code actually uses each name their own whole sentence.
const PERMISSION_MESSAGE_KEYS: Record<string, string> = {
    'project:create': 'projects:errors.permissions.createProject',
    'project:read': 'projects:errors.permissions.readProject',
    'project:update': 'projects:errors.permissions.updateProject',
    'project:delete': 'projects:errors.permissions.deleteProject',
};

export async function checkPermission(user: IUser, resource: string, action: string, knexConnection?: Knex | Knex.Transaction): Promise<ActionPermissionError | null> {
    try {
        const hasPermissionResult = await hasPermission(user, resource, action, knexConnection);
        if (!hasPermissionResult) {
            return permissionError(
                `Permission denied: Cannot ${action} ${resource}`,
                PERMISSION_MESSAGE_KEYS[`${resource}:${action}`],
            );
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

/** The projects the caller may read, each with the redaction set the kernel decided for it. */
export async function decideAuthorizedProjects<T extends Partial<IProject>>(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projects: T[]
): Promise<Array<{ project: T; redactedFields: string[] }>> {
  if (projects.length === 0) {
    return [];
  }

  const decide = await createProjectReadDecider(trx, tenant, user);
  const decisions = await Promise.all(projects.map((project) => decide(project)));
  return projects.flatMap((project, index) =>
    decisions[index].allowed ? [{ project, redactedFields: decisions[index].redactedFields }] : []
  );
}

/**
 * The projects the caller may read, each as the caller may see it: fields the decision redacts are omitted the
 * way the REST project endpoints omit them, and a project whose identity is redacted is dropped. Rows of a
 * caller without redactions are returned untouched.
 */
export async function filterAuthorizedProjects<T extends Partial<IProject>>(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projects: T[]
): Promise<T[]> {
  const authorized = await decideAuthorizedProjects(trx, tenant, user, projects);
  return authorized.flatMap(({ project, redactedFields }) => {
    const readable = projectReadableRecord('project', project, redactedFields);
    return readable ? [readable] : [];
  });
}


/**
 * All projects the user may read, each with its phases and their statuses. The body of the
 * `getProjectsWithPhases` action, shared with the batched reference-list loader so both return
 * exactly the same thing for the same user: a `project:read` denial comes back as a permission
 * error, and the list is narrowed by `filterAuthorizedProjects`. Other failures throw.
 */
export async function loadProjectsWithPhases(
  knex: Knex,
  tenant: string,
  user: IUserWithRoles
): Promise<ProjectWithPhases[] | ActionPermissionError> {
  const denied = await checkPermission(user, 'project', 'read', knex);
  if (denied) return denied;

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, tenant);
    const statusMappingsQuery = tenantDb(trx, tenant).table('project_status_mappings as psm');
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
      db.table('projects')
        .select('project_id', 'project_name', 'is_inactive', 'client_id', 'assigned_to')
        .orderBy('project_name'),
      db.table('project_phases')
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
}
