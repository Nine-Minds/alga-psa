import { createTenantKnex } from 'server/src/lib/db';
import { ITicket } from 'server/src/interfaces/ticket.interfaces';
import { z } from 'zod';


const Ticket = {
  getAll: async (): Promise<ITicket[]> => {
    try {
      const { knex: db, tenant } = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      const tickets = await db<ITicket>('tickets')
        .where({ tenant })
        .select('*');
      return tickets;
    } catch (error) {
      console.error('Error getting all tickets:', error);
      throw error;
    }
  },

  get: async (id: string): Promise<ITicket> => {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }
    const [ticket] = await db('tickets')
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

  insert: async (ticket: Partial<ITicket>): Promise<Pick<ITicket, "ticket_id">> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      // RLS will automatically set the tenant for the new ticket
      const [insertedTicket] = await db<ITicket>('tickets').insert({ ...ticket, tenant: tenant! }).returning('ticket_id');
      return { ticket_id: insertedTicket.ticket_id };
    } catch (error) {
      console.error('Error inserting ticket:', error);
      throw error;
    }
  },

  update: async (id: string, ticket: Partial<ITicket>): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      await db<ITicket>('tickets')
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

  delete: async (id: string): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant not found');
      }
      await db<ITicket>('tickets')
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
