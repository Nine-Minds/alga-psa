import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery, tenantJoinIndexerTable } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface TicketSearchRow {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  client_name: string | null;
  entered_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: TicketSearchRow): Date {
  const value = row.updated_at ?? row.entered_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: TicketSearchRow): SearchDoc {
  const identifier = row.ticket_number ?? undefined;

  return {
    tenant,
    objectType: 'ticket',
    objectId: row.ticket_id,
    title: row.title ?? identifier ?? row.ticket_id,
    subtitle: compactJoin([row.client_name, identifier]),
    url: `/msp/tickets/${row.ticket_id}`,
    metadata: identifier ? { identifier } : undefined,
    acl: {
      requiredPermission: 'ticket:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseTicketQuery(knex: Knex, tenant: string) {
  const query = createTenantScopedIndexerQuery<TicketSearchRow>(knex, 'tickets as t', 't', tenant);
  tenantJoinIndexerTable(knex, tenant, query, 'clients as c', 'c.client_id', 't.client_id', { type: 'left' });

  return query
    .select(
      't.ticket_id',
      't.ticket_number',
      't.title',
      't.entered_at',
      't.updated_at',
      'c.client_name',
    );
}

export const ticketIndexer: EntityIndexer = {
  objectType: 'ticket',
  sourceEvents: ['TICKET_CREATED', 'TICKET_UPDATED', 'TICKET_CLOSED', 'TICKET_ASSIGNED', 'TICKET_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseTicketQuery(knex, tenant)
      .andWhere('t.ticket_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseTicketQuery(knex, tenant)
      .orderBy('t.ticket_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('t.ticket_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
