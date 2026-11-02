import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IProject, IUserWithRoles } from '@alga-psa/types';
import ProjectModel from '../models/project';
import { createProjectReadDecider } from './projectReadAuthorization';

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

/** Decide from identity columns first, then load only each allowed group's masked resource projection. */
export async function loadAuthorizedProjectProjections(
  trx: Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  projectIds: string[],
  callerRedactions: Record<string, string[]> = {}
): Promise<Array<{ project: IProject; redactedFields: string[] }>> {
  const ids = Array.from(new Set(projectIds.filter((id) => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return [];

  const identities = await tenantScopedTable(trx, 'projects', tenant)
    .whereIn('project_id', ids)
    .select<Array<Partial<IProject>>>('project_id', 'assigned_to', 'client_id');
  const decide = await createProjectReadDecider(trx, tenant, user);
  const decisions = await Promise.all(identities.map(async (project) => ({ project, ...(await decide(project)) })));
  const allowed = decisions.filter((entry) => entry.allowed && entry.project.project_id);
  const groups = new Map<string, { redactedFields: string[]; ids: string[] }>();
  for (const { project, redactedFields } of allowed) {
    const id = project.project_id!;
    const fields = Array.from(new Set([...redactedFields, ...(callerRedactions[id] ?? [])])).sort();
    const key = JSON.stringify(fields);
    const group = groups.get(key) ?? { redactedFields: fields, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
  }

  const projections: IProject[] = [];
  for (const group of groups.values()) {
    projections.push(...(group.redactedFields.length === 0
      ? await ProjectModel.getByIds(trx, tenant, group.ids)
      : await ProjectModel.getMaskedByIds(trx, tenant, group.ids, group.redactedFields)));
  }
  const byId = new Map(projections.map((project) => [project.project_id, project] as const));
  const redactionsById = new Map(allowed.map(({ project, redactedFields }) => [
    project.project_id!, Array.from(new Set([...redactedFields, ...(callerRedactions[project.project_id!] ?? [])])),
  ]));
  return ids.flatMap((id) => {
    const project = byId.get(id);
    const redactedFields = redactionsById.get(id);
    return project && redactedFields ? [{ project, redactedFields }] : [];
  });
}
