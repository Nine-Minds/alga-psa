import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ProjectSearchRow {
  project_id: string;
  project_name: string;
  description: string | null;
  client_id: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: ProjectSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ProjectSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'project',
    objectId: row.project_id,
    title: row.project_name,
    body: row.description ?? undefined,
    url: `/msp/projects/${row.project_id}`,
    acl: {
      requiredPermission: 'project:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const projectIndexer: EntityIndexer = {
  objectType: 'project',
  sourceEvents: ['PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_STATUS_CHANGED', 'PROJECT_CLOSED', 'PROJECT_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<ProjectSearchRow>('projects')
      .select('project_id', 'project_name', 'description', 'client_id', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .andWhere('project_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<ProjectSearchRow>('projects')
      .select('project_id', 'project_name', 'description', 'client_id', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .orderBy('project_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('project_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
