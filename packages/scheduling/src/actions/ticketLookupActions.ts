'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

export interface SchedulingTicketDetailsRecord {
  ticket_id: string;
  ticket_number: string | null;
  title: string | null;
  description: string | null;
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
    return trx('tickets as t')
      .leftJoin('statuses as s', function joinStatuses() {
        this.on('t.status_id', '=', 's.status_id')
          .andOn('t.tenant', '=', 's.tenant');
      })
      .leftJoin('priorities as p', function joinPriorities() {
        this.on('t.priority_id', '=', 'p.priority_id')
          .andOn('t.tenant', '=', 'p.tenant');
      })
      .leftJoin('boards as b', function joinBoards() {
        this.on('t.board_id', '=', 'b.board_id')
          .andOn('t.tenant', '=', 'b.tenant');
      })
      .leftJoin('clients as c', function joinClients() {
        this.on('t.client_id', '=', 'c.client_id')
          .andOn('t.tenant', '=', 'c.tenant');
      })
      .leftJoin('contacts as ct', function joinContacts() {
        this.on('t.contact_name_id', '=', 'ct.contact_name_id')
          .andOn('t.tenant', '=', 'ct.tenant');
      })
      .leftJoin('users as u', function joinUsers() {
        this.on('t.assigned_to', '=', 'u.user_id')
          .andOn('t.tenant', '=', 'u.tenant');
      })
      .where({
        't.ticket_id': ticketId,
        't.tenant': tenant,
      })
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.description',
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

  return (ticket ?? null) as SchedulingTicketDetailsRecord | null;
});
