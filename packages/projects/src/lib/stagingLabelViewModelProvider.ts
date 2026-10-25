import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import { getContainers, type StagingContainerView } from '@alga-psa/inventory/lib/stagingContainers';
import {
  recordUrl,
  type IUserWithRoles,
  type LabelRequestContext,
  type LabelViewModel,
  type LabelViewModelProvider,
} from '@alga-psa/types';
import type { Knex } from 'knex';

import { createProjectReadAuthorizer } from './projectReadAuthorization';

/**
 * Read the staging boxes a caller may see, in the order asked: `project:read` RBAC, then the
 * record-level project read decision for each box's project. A missing box, a deleted box and a box on
 * a project the caller may not read are all null, indistinguishable (C1 provider contract; a scan the
 * user cannot open reveals nothing). Read-only.
 */
export async function readAuthorizedStagingContainers(
  knex: Knex,
  tenant: string,
  user: IUserWithRoles,
  containerIds: readonly string[],
): Promise<Array<StagingContainerView | null>> {
  if (!(await hasPermission(user, 'project', 'read'))) {
    return containerIds.map(() => null);
  }
  const containers = await getContainers(knex, tenant, containerIds);
  const projectIds = [...new Set(containers.filter(Boolean).map((c) => c!.project_id))];
  if (projectIds.length === 0) return containers;
  const projects = await knex('projects')
    .where({ tenant })
    .whereIn('project_id', projectIds)
    .select('project_id', 'client_id', 'assigned_to');
  const authorize = await createProjectReadAuthorizer(knex, tenant, user);
  const allowed = new Set<string>();
  for (const project of projects) {
    if (await authorize(project)) allowed.add(project.project_id);
  }
  return containers.map((c) => (c && allowed.has(c.project_id) ? c : null));
}

/** The printable box label: the box identifier is both the human-readable line and the Code 128 value. */
export function stagingContainerLabelViewModel(container: StagingContainerView, baseUrl: string): LabelViewModel {
  return {
    labelClass: 'staging-container',
    entityType: 'staging_container',
    recordId: container.container_id,
    url: recordUrl('staging_container', container.container_id, baseUrl, { projectId: container.project_id }),
    identifier: container.identifier,
    code128Value: container.identifier,
    title: `${container.project_number} ${container.project_name}`.trim(),
    clientName: container.client_name ?? null,
    detail: container.task_name ?? container.name ?? null,
    secondaryIdentifier: null,
    serialSuffix: null,
    sequence: { n: container.position.n, total: container.position.total },
  };
}

export const stagingContainerLabelViewModelProvider: LabelViewModelProvider = {
  entityType: 'staging_container',
  labelClass: 'staging-container',

  async getLabelViewModels(context: LabelRequestContext, ids: readonly string[]) {
    const { knex } = await createTenantKnex(context.tenant);
    const containers = await readAuthorizedStagingContainers(knex, context.tenant, context.user, ids);
    return containers.map((c) => (c ? stagingContainerLabelViewModel(c, context.baseUrl) : null));
  },
};
