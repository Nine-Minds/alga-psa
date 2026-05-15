import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ProjectPhaseSearchRow {
  phase_id: string;
  project_id: string;
  phase_name: string;
  description: string | null;
  project_name: string | null;
  client_id: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: ProjectPhaseSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ProjectPhaseSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'project_phase',
    objectId: row.phase_id,
    parentType: 'project',
    parentId: row.project_id,
    title: row.phase_name,
    subtitle: row.project_name ?? undefined,
    body: row.description ?? undefined,
    url: `/msp/projects/${row.project_id}/phases/${row.phase_id}`,
    acl: {
      requiredPermission: 'project:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseProjectPhaseQuery(knex: Knex, tenant: string) {
  return knex<ProjectPhaseSearchRow>('project_phases as ph')
    .join('projects as p', function() {
      this.on('p.tenant', 'ph.tenant').andOn('p.project_id', 'ph.project_id');
    })
    .select(
      'ph.phase_id',
      'ph.project_id',
      'ph.phase_name',
      'ph.description',
      'ph.created_at',
      'ph.updated_at',
      'p.project_name',
      'p.client_id',
    )
    .where('ph.tenant', tenant);
}

export const projectPhaseIndexer: EntityIndexer = {
  objectType: 'project_phase',
  sourceEvents: ['PROJECT_PHASE_CREATED', 'PROJECT_PHASE_UPDATED', 'PROJECT_PHASE_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseProjectPhaseQuery(knex, tenant)
      .andWhere('ph.phase_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseProjectPhaseQuery(knex, tenant)
      .orderBy('ph.phase_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('ph.phase_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
