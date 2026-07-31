'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface SchedulingTicketDetailsRecord {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  description: string | null;
  attributes?: Record<string, unknown> | null;
  status: string | null;
  priority: string | null;
  board_name: string | null;
  client_name: string | null;
  contact_name: string | null;
  assigned_user_name: string | null;
  entered_at: Date | string | null;
  updated_at: Date | string | null;
  closed_at: Date | string | null;
}

export const getSchedulingTicketById = withAuth(async (
  _user,
  { tenant },
  ticketId: string
): Promise<SchedulingTicketDetailsRecord | null> => {
  const { knex } = await createTenantKnex();

  const ticket = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const scopedDb = tenantDb(trx, tenant) as any;
    const query = scopedDb.table('tickets as t');
    scopedDb.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'priorities as p', 't.priority_id', 'p.priority_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'boards as b', 't.board_id', 'b.board_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'clients as c', 't.client_id', 'c.client_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'contacts as ct', 't.contact_name_id', 'ct.contact_name_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'users as u', 't.assigned_to', 'u.user_id', { type: 'left' });
    return query
      .where({
        't.ticket_id': ticketId,
      })
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.attributes',
        't.entered_at',
        't.updated_at',
        't.closed_at',
        's.name as status',
        'p.priority_name as priority',
        'b.board_name',
        'c.client_name',
        'ct.full_name as contact_name',
        trx.raw(`CASE WHEN u.first_name IS NOT NULL OR u.last_name IS NOT NULL
          THEN TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')))
          ELSE u.username END as assigned_user_name`)
      )
      .first();
  });

  if (!ticket) {
    return null;
  }

  const attributes = (ticket.attributes && typeof ticket.attributes === 'object')
    ? ticket.attributes as Record<string, unknown>
    : null;
  const rawDescription = attributes?.description;
  const description = typeof rawDescription === 'string'
    ? rawDescription
    : rawDescription == null
      ? null
      : JSON.stringify(rawDescription);

  return {
    ...(ticket as Omit<SchedulingTicketDetailsRecord, 'description'>),
    attributes,
    description,
  };
});
