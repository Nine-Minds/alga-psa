import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface StatusSearchRow {
  name: string;
  is_closed: boolean | null;
  created_at?: Date | string | null;
}

// Source of truth: packages/tickets/src/lib/ticketStatusFilter.ts
// (TICKET_STATUS_NAME_PREFIX). The ticketing dashboard filters by status
// *name* (deduplicated across boards), not by status_id/board, so a search
// result for a ticket status must link to the same name-based filter value.
const TICKET_STATUS_NAME_PREFIX = '__status_name__:';

function ticketStatusFilterUrl(name: string): string {
  const value = `${TICKET_STATUS_NAME_PREFIX}${encodeURIComponent(name)}`;
  return `/msp/tickets?${new URLSearchParams({ statusId: value }).toString()}`;
}

function toSearchDoc(tenant: string, row: StatusSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'status',
    // Keyed by name, not status_id: ticket statuses are board-scoped so the
    // same name (e.g. "Open") exists once per board. We index one row per
    // distinct name to mirror the dashboard's grouped filter.
    objectId: row.name,
    title: row.name,
    subtitle: 'Ticket status',
    url: ticketStatusFilterUrl(row.name),
    metadata: {
      status_type: 'ticket',
      is_closed: Boolean(row.is_closed),
    },
    acl: {
      requiredPermission: 'ticket:read',
    },
    sourceUpdatedAt: row.created_at ? new Date(row.created_at) : new Date(),
  };
}

export const statusIndexer: EntityIndexer = {
  objectType: 'status',
  sourceEvents: ['STATUS_CREATED', 'STATUS_UPDATED', 'STATUS_DELETED'],

  // `id` is either a status_id (live event path) or a status name (reconcile
  // delete-sweep, which calls loadOne with the indexed object_id = name).
  // Either way resolve to the name-keyed doc, and only for ticket statuses;
  // the doc survives as long as any ticket status with that name remains.
  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<StatusSearchRow>('statuses')
      .select('name', 'is_closed', 'created_at')
      .where('tenant', tenant)
      .andWhere('status_type', 'ticket')
      .andWhere((builder) => {
        builder.where('name', id).orWhere('status_id', id);
      })
      .orderBy('name', 'asc')
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<StatusSearchRow>('statuses')
      .distinctOn('name')
      .select('name', 'is_closed', 'created_at')
      .where('tenant', tenant)
      .andWhere('status_type', 'ticket')
      .orderBy('name', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('name', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
