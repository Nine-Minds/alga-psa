import type { Knex } from 'knex';
import type { IUserWithRoles, IProjectTask } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import { authorizeProjectsByIds } from '@alga-psa/authorization/projectReadAuthorization';
import { loadAuthorizedProjectPhase } from './projectPhaseReadProjection';
import { loadAuthorizedProjectTasks } from './projectTaskReadProjection';
import ProjectModel from '../models/project';
import { coManagedColumnHidden } from '@alga-psa/co-managed/projectFieldMask';

export interface ProjectTaskActivityIdentity { taskId: string; projectId: string }
export interface AuthorizedProjectTaskActivity {
  task: IProjectTask & { assigned_to_name: string | null; project_id: string };
  projectName: string | null;
  projectIsClosed: boolean;
  clientId: string | null;
  phaseName: string | null;
  statusName: string | null;
  isClosed: boolean;
  priorityName: string | null;
  priorityColor: string | null;
}

/** Resolve candidate identities first, retain each decision, and only then load masked activity data. */
export async function loadAuthorizedProjectTaskActivities(
  trx: Knex.Transaction,
  tenant: string,
  reader: IUserWithRoles,
  identities: ProjectTaskActivityIdentity[],
): Promise<AuthorizedProjectTaskActivity[]> {
  const projectIds = [...new Set(identities.map(({ projectId }) => projectId))];
  const decisions = await authorizeProjectsByIds(trx, tenant, reader, projectIds);
  const decisionByProject = new Map<string, { allowed: boolean; redactedFields: string[] }>();
  for (const { project, allowed, redactedFields } of decisions) {
    if (project.project_id) decisionByProject.set(project.project_id, { allowed, redactedFields: [...new Set(redactedFields)].sort() });
  }
  const groups = new Map<string, { redactedFields: string[]; identities: ProjectTaskActivityIdentity[] }>();
  for (const identity of identities) {
    const decision = decisionByProject.get(identity.projectId);
    if (!decision?.allowed) continue;
    const key = JSON.stringify(decision.redactedFields);
    const group = groups.get(key) ?? { redactedFields: decision.redactedFields, identities: [] };
    group.identities.push(identity);
    groups.set(key, group);
  }

  const output: AuthorizedProjectTaskActivity[] = [];
  for (const group of groups.values()) {
    const idsByProject = new Map<string, string[]>();
    for (const { projectId, taskId } of group.identities) {
      const ids = idsByProject.get(projectId) ?? [];
      ids.push(taskId);
      idsByProject.set(projectId, ids);
    }
    const projectRows = group.redactedFields.length
      ? await ProjectModel.getMaskedByIds(trx, tenant, [...idsByProject.keys()], group.redactedFields)
      : await ProjectModel.getByIds(trx, tenant, [...idsByProject.keys()]);
    const projectsById = new Map(projectRows.map((project) => [project.project_id, project]));
    const db = tenantDb(trx, tenant);
    for (const [projectId, taskIds] of idsByProject) {
      const project = projectsById.get(projectId);
      if (!project) continue;
      const tasks = await loadAuthorizedProjectTasks(trx, tenant, projectId, group.redactedFields, taskIds);
      for (const task of tasks) {
        const phase = task.phase_id
          ? await loadAuthorizedProjectPhase(trx, tenant, task.phase_id, group.redactedFields)
          : null;
        const phaseName = phase?.project_id === projectId ? phase.phase_name : null;
        const mappingId = task.project_status_mapping_id;
        let statusName: string | null = null;
        let isClosed = false;
        if (mappingId) {
          const statusQuery = db.table('project_status_mappings as psm');
          db.tenantJoin(statusQuery, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
          db.tenantJoin(statusQuery, 'statuses as cs', 'psm.status_id', 'cs.status_id', { type: 'left' });
          const status = await statusQuery
            .where('psm.project_status_mapping_id', mappingId)
            .select(trx.raw('COALESCE(psm.custom_name, cs.name, ss.name) as status_name'),
              trx.raw('COALESCE(cs.is_closed, ss.is_closed, false) as is_closed'))
            .first();
          statusName = status?.status_name ?? null;
          isClosed = Boolean(status?.is_closed);
        }
        const priority = task.priority_id
          ? await db.table('priorities').where({ priority_id: task.priority_id }).select('priority_name', 'color').first()
          : null;
        output.push({
          task, projectName: project.project_name ?? null,
          projectIsClosed: Boolean(project.is_closed),
          clientId: coManagedColumnHidden(group.redactedFields, 'projects', 'client_id') ? null : project.client_id ?? null,
          phaseName, statusName, isClosed,
          priorityName: priority?.priority_name ?? null, priorityColor: priority?.color ?? null,
        });
      }
    }
  }
  return output;
}
