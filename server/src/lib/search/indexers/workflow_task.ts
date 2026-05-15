import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface WorkflowTaskSearchRow {
  task_id: string;
  title: string;
  description: string | null;
  assigned_users: unknown;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function parseAssignedUserIds(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      return parseAssignedUserIds(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (!Array.isArray(value)) {
    return [];
  }

  const ids = value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (entry && typeof entry === 'object') {
        const candidate = entry as { user_id?: unknown; userId?: unknown; id?: unknown };
        if (typeof candidate.user_id === 'string') {
          return candidate.user_id;
        }
        if (typeof candidate.userId === 'string') {
          return candidate.userId;
        }
        if (typeof candidate.id === 'string') {
          return candidate.id;
        }
      }

      return undefined;
    })
    .filter((id): id is string => Boolean(id));

  return Array.from(new Set(ids));
}

function toSourceUpdatedAt(row: WorkflowTaskSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: WorkflowTaskSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'workflow_task',
    objectId: row.task_id,
    title: row.title,
    body: row.description ?? undefined,
    url: `/msp/workflow-tasks/${row.task_id}`,
    acl: {
      requiredPermission: 'workflow_task:read',
      visibleToUserIds: parseAssignedUserIds(row.assigned_users),
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const workflowTaskIndexer: EntityIndexer = {
  objectType: 'workflow_task',
  sourceEvents: [
    'WORKFLOW_TASK_CREATED',
    'WORKFLOW_TASK_UPDATED',
    'WORKFLOW_TASK_DELETED',
    'WORKFLOW_TASK_ASSIGNMENT_CHANGED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<WorkflowTaskSearchRow>('workflow_tasks')
      .select('task_id', 'title', 'description', 'assigned_users', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .andWhere('task_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<WorkflowTaskSearchRow>('workflow_tasks')
      .select('task_id', 'title', 'description', 'assigned_users', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .orderBy('task_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('task_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
