import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery, tenantJoinIndexerTable } from '../tenantScopedIndexerQuery';
import { flattenBlockNote } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ProjectTaskCommentSearchRow {
  task_comment_id: string;
  task_id: string;
  note: string | null;
  markdown_content: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  edited_at?: Date | string | null;
  task_name: string | null;
  project_id: string;
  project_name: string | null;
  client_id: string | null;
}

function toSourceUpdatedAt(row: ProjectTaskCommentSearchRow): Date {
  const value = row.edited_at ?? row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function bodyFromRow(row: ProjectTaskCommentSearchRow): string | undefined {
  const markdown = row.markdown_content?.trim();
  if (markdown) {
    return markdown;
  }
  return row.note ? flattenBlockNote(row.note) : undefined;
}

function toSearchDoc(tenant: string, row: ProjectTaskCommentSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'project_task_comment',
    objectId: row.task_comment_id,
    parentType: 'project_task',
    parentId: row.task_id,
    title: row.task_name ?? row.task_id,
    subtitle: row.project_name ?? undefined,
    body: bodyFromRow(row),
    url: `/msp/projects/${row.project_id}/tasks/${row.task_id}#comment-${row.task_comment_id}`,
    acl: {
      requiredPermission: 'project:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseProjectTaskCommentQuery(knex: Knex, tenant: string) {
  const query = createTenantScopedIndexerQuery<ProjectTaskCommentSearchRow>(knex, 'project_task_comments as pc', 'pc', tenant);
  tenantJoinIndexerTable(knex, tenant, query, 'project_tasks as pt', 'pt.task_id', 'pc.task_id');
  tenantJoinIndexerTable(knex, tenant, query, 'project_phases as ph', 'ph.phase_id', 'pt.phase_id');
  tenantJoinIndexerTable(knex, tenant, query, 'projects as p', 'p.project_id', 'ph.project_id');

  return query
    .select(
      'pc.task_comment_id',
      'pc.task_id',
      'pc.note',
      'pc.markdown_content',
      'pc.created_at',
      'pc.updated_at',
      'pc.edited_at',
      'pt.task_name',
      'ph.project_id',
      'p.project_name',
      'p.client_id',
    );
}

export const projectTaskCommentIndexer: EntityIndexer = {
  objectType: 'project_task_comment',
  sourceEvents: [
    'TASK_COMMENT_ADDED',
    'TASK_COMMENT_UPDATED',
    'PROJECT_TASK_COMMENT_CREATED',
    'PROJECT_TASK_COMMENT_UPDATED',
    'PROJECT_TASK_COMMENT_DELETED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseProjectTaskCommentQuery(knex, tenant)
      .andWhere('pc.task_comment_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseProjectTaskCommentQuery(knex, tenant)
      .orderBy('pc.task_comment_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('pc.task_comment_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
