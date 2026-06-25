import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ProjectTaskSearchRow {
  task_id: string;
  phase_id: string;
  project_id: string;
  task_name: string;
  description: string | null;
  project_name: string | null;
  client_id: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: ProjectTaskSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ProjectTaskSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'project_task',
    objectId: row.task_id,
    parentType: 'project',
    parentId: row.project_id,
    title: row.task_name,
    subtitle: row.project_name ?? undefined,
    body: row.description ?? undefined,
    url: `/msp/projects/${row.project_id}/tasks/${row.task_id}`,
    acl: {
      requiredPermission: 'project:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseProjectTaskQuery(knex: Knex, tenant: string) {
  return createTenantScopedIndexerQuery<ProjectTaskSearchRow>(knex, 'project_tasks as pt', 'pt', tenant)
    .join('project_phases as ph', function() {
      this.on('ph.tenant', 'pt.tenant').andOn('ph.phase_id', 'pt.phase_id');
    })
    .join('projects as p', function() {
      this.on('p.tenant', 'ph.tenant').andOn('p.project_id', 'ph.project_id');
    })
    .select(
      'pt.task_id',
      'pt.phase_id',
      'pt.task_name',
      'pt.description',
      'pt.created_at',
      'pt.updated_at',
      'ph.project_id',
      'p.project_name',
      'p.client_id',
    );
}

export const projectTaskIndexer: EntityIndexer = {
  objectType: 'project_task',
  sourceEvents: [
    'PROJECT_TASK_CREATED',
    'PROJECT_TASK_UPDATED',
    'PROJECT_TASK_DELETED',
    'PROJECT_TASK_ASSIGNED',
    'PROJECT_TASK_COMPLETED',
    'PROJECT_TASK_STATUS_CHANGED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseProjectTaskQuery(knex, tenant)
      .andWhere('pt.task_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseProjectTaskQuery(knex, tenant)
      .orderBy('pt.task_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('pt.task_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
