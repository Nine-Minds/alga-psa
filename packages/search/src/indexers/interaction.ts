import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery, tenantJoinIndexerTable } from '../tenantScopedIndexerQuery';
import { flattenBlockNote, truncateForIndex } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface InteractionSearchRow {
  interaction_id: string;
  title: string | null;
  notes: string | null;
  type_name: string | null;
  client_name: string | null;
  contact_name: string | null;
  ticket_number: string | null;
  ticket_title: string | null;
  interaction_date?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: InteractionSearchRow): Date {
  const value = row.interaction_date;
  return value ? new Date(value) : new Date();
}

function ticketLabel(row: InteractionSearchRow): string | undefined {
  return compactJoin([row.ticket_number, row.ticket_title]);
}

function toSearchDoc(tenant: string, row: InteractionSearchRow): SearchDoc {
  const body = row.notes ? truncateForIndex(flattenBlockNote(row.notes)) : undefined;

  return {
    tenant,
    objectType: 'interaction',
    objectId: row.interaction_id,
    title: row.title?.trim() || 'Untitled interaction',
    subtitle: compactJoin([row.type_name, row.client_name, row.contact_name, ticketLabel(row)]),
    body,
    url: `/msp/interactions/${row.interaction_id}`,
    acl: {
      requiredPermission: 'interaction:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

function baseInteractionQuery(knex: Knex, tenant: string) {
  const query = createTenantScopedIndexerQuery<InteractionSearchRow>(knex, 'interactions as i', 'i', tenant);
  tenantJoinIndexerTable(knex, tenant, query, 'interaction_types as it', 'it.type_id', 'i.type_id', { type: 'left' });
  tenantJoinIndexerTable(knex, tenant, query, 'clients as c', 'c.client_id', 'i.client_id', { type: 'left' });
  tenantJoinIndexerTable(knex, tenant, query, 'contacts as cn', 'cn.contact_name_id', 'i.contact_name_id', { type: 'left' });
  tenantJoinIndexerTable(knex, tenant, query, 'tickets as t', 't.ticket_id', 'i.ticket_id', { type: 'left' });

  return query
    .select(
      'i.interaction_id',
      'i.title',
      'i.notes',
      'i.interaction_date',
      'it.type_name',
      'c.client_name',
      'cn.full_name as contact_name',
      't.ticket_number',
      't.title as ticket_title',
    );
}

export const interactionIndexer: EntityIndexer = {
  objectType: 'interaction',
  sourceEvents: ['INTERACTION_CREATED', 'INTERACTION_UPDATED', 'INTERACTION_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await baseInteractionQuery(knex, tenant)
      .andWhere('i.interaction_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = baseInteractionQuery(knex, tenant)
      .orderBy('i.interaction_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('i.interaction_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
