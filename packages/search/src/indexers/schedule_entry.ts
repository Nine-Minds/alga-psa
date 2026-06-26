import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery, tenantJoinIndexerTable } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ScheduleEntrySearchRow {
  entry_id: string;
  title: string;
  notes: string | null;
  scheduled_start?: Date | string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  assigned_user_ids: string[] | null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function toSourceUpdatedAt(row: ScheduleEntrySearchRow): Date {
  const value = row.updated_at ?? row.scheduled_start ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ScheduleEntrySearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'schedule_entry',
    objectId: row.entry_id,
    title: row.title,
    body: row.notes ?? undefined,
    url: `/msp/schedule/${row.entry_id}`,
    acl: {
      requiredPermission: 'schedule:read',
      visibleToUserIds: toStringArray(row.assigned_user_ids),
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseScheduleEntryQuery(knex: Knex, tenant: string) {
  const query = createTenantScopedIndexerQuery<ScheduleEntrySearchRow>(knex, 'schedule_entries as se', 'se', tenant);
  tenantJoinIndexerTable(knex, tenant, query, 'schedule_entry_assignees as sea', 'sea.entry_id', 'se.entry_id', { type: 'left' });

  return query
    .select(
      'se.entry_id',
      'se.title',
      'se.notes',
      'se.scheduled_start',
      'se.created_at',
      'se.updated_at',
      knex.raw('array_remove(array_agg(distinct sea.user_id), NULL) as assigned_user_ids'),
    )
    .groupBy(
      'se.entry_id',
      'se.title',
      'se.notes',
      'se.scheduled_start',
      'se.created_at',
      'se.updated_at',
    );
}

export const scheduleEntryIndexer: EntityIndexer = {
  objectType: 'schedule_entry',
  sourceEvents: [
    'SCHEDULE_ENTRY_CREATED',
    'SCHEDULE_ENTRY_UPDATED',
    'SCHEDULE_ENTRY_DELETED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseScheduleEntryQuery(knex, tenant)
      .andWhere('se.entry_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseScheduleEntryQuery(knex, tenant)
      .orderBy('se.entry_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('se.entry_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
