// server/src/lib/models/ticket-resource.tsx
import logger from '../../utils/logger';
import { ITicketResource } from '../../interfaces/ticketResource.interfaces';
import { createTenantKnex } from '../db';
import { v4 as uuid4 } from 'uuid';

const TicketResource = {
  create: async (resourceData: Omit<ITicketResource, 'assignment_id' | 'tenant'>): Promise<ITicketResource> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for creating ticket resource');
      }

      // Verify ticket exists in the current tenant
      const ticket = await db('tickets')
        .where({
          ticket_id: resourceData.ticket_id,
          tenant
        })
        .first();

      if (!ticket) {
        throw new Error(`Ticket with id ${resourceData.ticket_id} not found in tenant ${tenant}`);
      }

      // Verify assigned user exists in the current tenant
      const assignedUser = await db('users')
        .where({
          user_id: resourceData.assigned_to,
          tenant
        })
        .first();

      if (!assignedUser) {
        throw new Error(`User with id ${resourceData.assigned_to} not found in tenant ${tenant}`);
      }

      // Verify additional user if provided
      if (resourceData.additional_user_id) {
        const additionalUser = await db('users')
          .where({
            user_id: resourceData.additional_user_id,
            tenant
          })
          .first();

        if (!additionalUser) {
          throw new Error(`Additional user with id ${resourceData.additional_user_id} not found in tenant ${tenant}`);
        }
      }

      const [createdResource] = await db<ITicketResource>('ticket_resources')
        .insert({
          ...resourceData,
          assignment_id: uuid4(),
          tenant,
          assigned_at: new Date()
        })
        .returning('*');

      if (!createdResource) {
        throw new Error(`Failed to create ticket resource in tenant ${tenant}`);
      }

      return createdResource;
    } catch (error) {
      logger.error('Error creating ticket resource:', error);
      throw error;
    }
  },

  getByTicketId: async (ticket_id: string): Promise<ITicketResource[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for getting ticket resources');
      }

      // Verify ticket exists in the current tenant
      const ticket = await db('tickets')
        .where({
          ticket_id,
          tenant
        })
        .first();

      if (!ticket) {
        throw new Error(`Ticket with id ${ticket_id} not found in tenant ${tenant}`);
      }

      const resources = await db<ITicketResource>('ticket_resources')
        .select('*')
        .where({
          ticket_id,
          tenant
        });

      return resources;
    } catch (error) {
      logger.error(`Error getting resources for ticket ${ticket_id}:`, error);
      throw error;
    }
  },

  remove: async (assignment_id: string): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for removing ticket resource');
      }

      // Verify resource exists in the current tenant
      const resource = await db<ITicketResource>('ticket_resources')
        .where({
          assignment_id,
          tenant
        })
        .first();

      if (!resource) {
        throw new Error(`Ticket resource with id ${assignment_id} not found in tenant ${tenant}`);
      }

      const deletedCount = await db<ITicketResource>('ticket_resources')
        .where({
          assignment_id,
          tenant
        })
        .del();

      if (deletedCount === 0) {
        throw new Error(`Failed to delete ticket resource with id ${assignment_id} in tenant ${tenant}`);
      }
    } catch (error) {
      logger.error(`Error removing ticket resource ${assignment_id}:`, error);
      throw error;
    }
  },

  update: async (assignment_id: string, data: Partial<ITicketResource>): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      if (!tenant) {
        throw new Error('Tenant context is required for updating ticket resource');
      }

      // Verify resource exists in the current tenant
      const resource = await db<ITicketResource>('ticket_resources')
        .where({
          assignment_id,
          tenant
        })
        .first();

      if (!resource) {
        throw new Error(`Ticket resource with id ${assignment_id} not found in tenant ${tenant}`);
      }

      // If assigned_to is being updated, verify the user exists in the tenant
      if (data.assigned_to) {
        const assignedUser = await db('users')
          .where({
            user_id: data.assigned_to,
            tenant
          })
          .first();

        if (!assignedUser) {
          throw new Error(`User with id ${data.assigned_to} not found in tenant ${tenant}`);
        }
      }

      // If additional_user_id is being updated, verify the user exists in the tenant
      if (data.additional_user_id) {
        const additionalUser = await db('users')
          .where({
            user_id: data.additional_user_id,
            tenant
          })
          .first();

        if (!additionalUser) {
          throw new Error(`Additional user with id ${data.additional_user_id} not found in tenant ${tenant}`);
        }
      }

      // Ensure tenant cannot be modified
      delete data.tenant;

      const updatedCount = await db<ITicketResource>('ticket_resources')
        .where({
          assignment_id,
          tenant
        })
        .update(data);

      if (updatedCount === 0) {
        throw new Error(`Failed to update ticket resource with id ${assignment_id} in tenant ${tenant}`);
      }
    } catch (error) {
      logger.error(`Error updating ticket resource ${assignment_id}:`, error);
      throw error;
    }
  }
};

export default TicketResource;
