/**
 * @alga-psa/tickets - Ticket Model
 *
 * Data access layer for ticket entities.
 * Migrated from server/src/lib/models/ticket.tsx
 *
 * Key changes from original:
 * - Tenant is an explicit parameter (not from getCurrentTenantId)
 * - This decouples the model from Next.js runtime
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { ITicket } from '@alga-psa/types';

function tenantScopedTable<Row extends object = Record<string, unknown>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

/**
 * Ticket model with tenant-explicit methods.
 * All methods require an explicit tenant parameter for multi-tenant safety.
 */
const Ticket = {
  /**
   * Get all tickets for a tenant.
   */
  getAll: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<ITicket[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting all tickets');
    }

    try {
      const tickets = await tenantScopedTable<ITicket>(knexOrTrx, 'tickets', tenant)
        .select('*');
      return tickets;
    } catch (error) {
      console.error('Error getting all tickets:', error);
      throw error;
    }
  },

  /**
   * Get a single ticket by ID.
   */
  get: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string
  ): Promise<ITicket | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting ticket');
    }

    const [ticket] = await tenantDb(knexOrTrx, tenant)
      .tenantJoin(
        tenantScopedTable(knexOrTrx, 'tickets', tenant),
        'priorities',
        'tickets.priority_id',
        'priorities.priority_id',
        { type: 'left' }
      )
      .select(
        'tickets.*',
        'priorities.priority_name'
      )
      .where({
        'tickets.ticket_id': id
      });

    return ticket || null;
  },

  /**
   * Get a ticket by its ticket number.
   */
  getByNumber: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    ticketNumber: string
  ): Promise<ITicket | null> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting ticket by number');
    }

    const [ticket] = await tenantScopedTable<ITicket>(knexOrTrx, 'tickets', tenant)
      .where({
        ticket_number: ticketNumber
      });

    return ticket || null;
  },

  /**
   * Create a new ticket.
   */
  insert: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    ticket: Omit<Partial<ITicket>, 'tenant' | 'ticket_id'>
  ): Promise<Pick<ITicket, 'ticket_id'>> => {
    if (!tenant) {
      throw new Error('Tenant context is required for creating ticket');
    }

    try {
      const [insertedTicket] = await tenantScopedTable<ITicket>(knexOrTrx, 'tickets', tenant)
        .insert({ ...ticket, tenant })
        .returning('ticket_id');
      return { ticket_id: insertedTicket.ticket_id };
    } catch (error) {
      console.error('Error inserting ticket:', error);
      throw error;
    }
  },

  /**
   * Update an existing ticket.
   */
  update: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string,
    ticket: Partial<Omit<ITicket, 'tenant' | 'ticket_id'>>
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for updating ticket');
    }

    try {
      const updated = await tenantScopedTable<ITicket>(knexOrTrx, 'tickets', tenant)
        .where({
          ticket_id: id
        })
        .update(ticket);

      if (updated === 0) {
        throw new Error(`Ticket ${id} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error updating ticket with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Delete a ticket.
   */
  delete: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    id: string
  ): Promise<void> => {
    if (!tenant) {
      throw new Error('Tenant context is required for deleting ticket');
    }

    try {
      const deleted = await tenantScopedTable<ITicket>(knexOrTrx, 'tickets', tenant)
        .where({
          ticket_id: id
        })
        .del();

      if (deleted === 0) {
        throw new Error(`Ticket ${id} not found in tenant ${tenant}`);
      }
    } catch (error) {
      console.error(`Error deleting ticket with id ${id}:`, error);
      throw error;
    }
  },

  /**
   * Get tickets by client ID.
   */
  getByClientId: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    clientId: string
  ): Promise<ITicket[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting tickets by client');
    }

    const tickets = await tenantScopedTable<ITicket>(knexOrTrx, 'tickets', tenant)
      .where({
        client_id: clientId
      })
      .select('*');

    return tickets;
  },

  /**
   * Get tickets by status ID.
   */
  getByStatusId: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    statusId: string
  ): Promise<ITicket[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting tickets by status');
    }

    const tickets = await tenantScopedTable<ITicket>(knexOrTrx, 'tickets', tenant)
      .where({
        status_id: statusId
      })
      .select('*');

    return tickets;
  },

  /**
   * Get tickets assigned to a specific user.
   */
  getByAssignedTo: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string,
    userId: string
  ): Promise<ITicket[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting tickets by assignee');
    }

    const tickets = await tenantScopedTable<ITicket>(knexOrTrx, 'tickets', tenant)
      .where({
        assigned_to: userId
      })
      .select('*');

    return tickets;
  },

  /**
   * Get open tickets (where status is not closed).
   */
  getOpen: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<ITicket[]> => {
    if (!tenant) {
      throw new Error('Tenant context is required for getting open tickets');
    }

    const tickets = await tenantDb(knexOrTrx, tenant)
      .tenantJoin(
        tenantScopedTable(knexOrTrx, 'tickets', tenant),
        'statuses',
        'tickets.status_id',
        'statuses.status_id'
      )
      .where({
        'statuses.is_closed': false
      })
      .select('tickets.*');

    return tickets;
  },

  /**
   * Count tickets by status for a tenant.
   */
  countByStatus: async (
    knexOrTrx: Knex | Knex.Transaction,
    tenant: string
  ): Promise<Record<string, number>> => {
    if (!tenant) {
      throw new Error('Tenant context is required for counting tickets');
    }

    const results = await tenantScopedTable(knexOrTrx, 'tickets', tenant)
      .groupBy('status_id')
      .select('status_id')
      .count('* as count');

    const rows = results as Array<{ status_id: string; count: string | number }>;

    return rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status_id as string] = Number(row.count);
      return acc;
    }, {});
  },
};

export default Ticket;
