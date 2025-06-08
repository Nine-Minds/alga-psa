import { getCurrentTenantId } from 'server/src/lib/db';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';
import { z } from 'zod';
import { Knex } from 'knex';


const Ticket = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<ITicket[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      const tickets = await knexOrTrx<ITicket>('tickets')
        .where({ tenant })
        .select('*');
      return tickets;
    } catch (error) {
      console.error('Error getting all tickets:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<ITicket> => {
    const tenant = await getCurrentTenantId();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    const [ticket] = await knexOrTrx('tickets')
      .select(
        'tickets.*',
        'priorities.priority_name'
      )
      .leftJoin('priorities', function() {
        this.on('tickets.priority_id', 'priorities.priority_id')
           .andOn('tickets.tenant', 'priorities.tenant')
      })
      .where({
        'tickets.ticket_id': id,
        'tickets.tenant': tenant
      });
    
    return ticket;
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, ticket: Partial<ITicket>): Promise<Pick<ITicket, "ticket_id">> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      // RLS will automatically set the tenant for the new ticket
      const [insertedTicket] = await knexOrTrx<ITicket>('tickets').insert({ ...ticket, tenant: tenant }).returning('ticket_id');
      return { ticket_id: insertedTicket.ticket_id };
    } catch (error) {
      console.error('Error inserting ticket:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, id: string, ticket: Partial<ITicket>): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      await knexOrTrx<ITicket>('tickets')
        .where({ 
          ticket_id: id,
          tenant: tenant 
        })
        .update(ticket);
    } catch (error) {
      console.error(`Error updating ticket with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      await knexOrTrx<ITicket>('tickets')
        .where({ 
          ticket_id: id,
          tenant: tenant 
        })
        .del();
    } catch (error) {
      console.error(`Error deleting ticket with id ${id}:`, error);
      throw error;
    }
  },
};

export default Ticket;
