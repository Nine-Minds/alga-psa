import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery, tenantJoinIndexerTable } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface TimeEntrySearchRow {
  entry_id: string;
  user_id: string | null;
  start_time: Date | string | null;
  work_date?: Date | string | null;
  notes: string;
  work_item_id: string | null;
  work_item_type: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
  ticket_number: string | null;
  ticket_title: string | null;
  task_name: string | null;
  project_id: string | null;
  interaction_title: string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function dateLabel(row: TimeEntrySearchRow): string | undefined {
  const value = row.work_date ?? row.start_time;
  if (!value) {
    return undefined;
  }

  return String(value).slice(0, 10);
}

function workItemLabel(row: TimeEntrySearchRow): string {
  if (row.work_item_type === 'ticket') {
    return compactJoin([row.ticket_number, row.ticket_title]) ?? 'Ticket';
  }

  if (row.work_item_type === 'project_task') {
    return row.task_name ?? 'Project task';
  }

  if (row.work_item_type === 'interaction') {
    return row.interaction_title ?? 'Interaction';
  }

  return row.work_item_type ?? 'Time entry';
}

function urlFor(row: TimeEntrySearchRow): string {
  if (row.work_item_type === 'ticket' && row.work_item_id) {
    return `/msp/tickets/${row.work_item_id}`;
  }

  if (row.work_item_type === 'project_task' && row.work_item_id && row.project_id) {
    return `/msp/projects/${row.project_id}/tasks/${row.work_item_id}`;
  }

  if (row.work_item_type === 'interaction' && row.work_item_id) {
    return `/msp/interactions/${row.work_item_id}`;
  }

  return `/msp/time-entries/${row.entry_id}`;
}

function toSourceUpdatedAt(row: TimeEntrySearchRow): Date {
  const value = row.updated_at ?? row.start_time ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: TimeEntrySearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'time_entry',
    objectId: row.entry_id,
    title: compactJoin([workItemLabel(row), dateLabel(row)]) ?? 'Time entry',
    body: row.notes,
    url: urlFor(row),
    acl: {
      requiredPermission: 'time:read',
      visibleToUserIds: row.user_id ? [row.user_id] : [],
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseTimeEntryQuery(knex: Knex, tenant: string) {
  const query = createTenantScopedIndexerQuery<TimeEntrySearchRow>(knex, 'time_entries as te', 'te', tenant);
  tenantJoinIndexerTable(knex, tenant, query, 'tickets as t', 't.ticket_id', 'te.work_item_id', { type: 'left' });
  tenantJoinIndexerTable(knex, tenant, query, 'project_tasks as pt', 'pt.task_id', 'te.work_item_id', { type: 'left' });
  tenantJoinIndexerTable(knex, tenant, query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id', { type: 'left' });
  tenantJoinIndexerTable(knex, tenant, query, 'interactions as i', 'i.interaction_id', 'te.work_item_id', { type: 'left' });

  return query
    .select(
      'te.entry_id',
      'te.user_id',
      'te.start_time',
      'te.work_date',
      'te.notes',
      'te.work_item_id',
      'te.work_item_type',
      'te.created_at',
      'te.updated_at',
      't.ticket_number',
      't.title as ticket_title',
      'pt.task_name',
      'pp.project_id',
      'i.title as interaction_title',
    )
    .whereNotNull('te.notes')
    .andWhere('te.notes', '<>', '');
}

export const timeEntryIndexer: EntityIndexer = {
  objectType: 'time_entry',
  sourceEvents: [
    'TIME_ENTRY_CREATED',
    'TIME_ENTRY_UPDATED',
    'TIME_ENTRY_DELETED',
    'TIME_ENTRY_SUBMITTED',
    'TIME_ENTRY_APPROVED',
    'TIME_ENTRY_CHANGES_REQUESTED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseTimeEntryQuery(knex, tenant)
      .andWhere('te.entry_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseTimeEntryQuery(knex, tenant)
      .orderBy('te.entry_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('te.entry_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
