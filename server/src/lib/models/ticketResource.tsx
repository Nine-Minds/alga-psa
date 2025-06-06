// server/src/lib/models/ticket-resource.tsx
import logger from '../../utils/logger';
import { ITicketResource } from '../../interfaces/ticketResource.interfaces';
import { getCurrentTenantId } from '../tenant';
import { v4 as uuid4 } from 'uuid';
import { Knex } from 'knex';

const TicketResource = {
  create: async (knexOrTrx: Knex | Knex.Transaction, resourceData: Omit<ITicketResource, 'assignment_id' | 'tenant'>): Promise<ITicketResource> => {
    try {
      const tenant = await getCurrentTenantId();

      // Verify ticket exists in the current tenant
      const ticket = await knexOrTrx('tickets')
        .where({
          ticket_id: resourceData.ticket_id,
          tenant
        })
        .first();

      if (!ticket) {
        throw new Error(`Ticket with id ${resourceData.ticket_id} not found in tenant ${tenant}`);
      }

      // Verify assigned user exists in the current tenant
      const assignedUser = await knexOrTrx('users')
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
        const additionalUser = await knexOrTrx('users')
          .where({
            user_id: resourceData.additional_user_id,
            tenant
          })
          .first();

        if (!additionalUser) {
          throw new Error(`Additional user with id ${resourceData.additional_user_id} not found in tenant ${tenant}`);
        }
      }

      const [createdResource] = await knexOrTrx<ITicketResource>('ticket_resources')
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

  getByTicketId: async (knexOrTrx: Knex | Knex.Transaction, ticket_id: string): Promise<ITicketResource[]> => {
    try {
      const tenant = await getCurrentTenantId();

      // Verify ticket exists in the current tenant
      const ticket = await knexOrTrx('tickets')
        .where({
          ticket_id,
          tenant
        })
        .first();

      if (!ticket) {
        throw new Error(`Ticket with id ${ticket_id} not found in tenant ${tenant}`);
      }

      const resources = await knexOrTrx<ITicketResource>('ticket_resources')
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

  remove: async (knexOrTrx: Knex | Knex.Transaction, assignment_id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();

      // Verify resource exists in the current tenant
      const resource = await knexOrTrx<ITicketResource>('ticket_resources')
        .where({
          assignment_id,
          tenant
        })
        .first();

      if (!resource) {
        throw new Error(`Ticket resource with id ${assignment_id} not found in tenant ${tenant}`);
      }

      const deletedCount = await knexOrTrx<ITicketResource>('ticket_resources')
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

  update: async (knexOrTrx: Knex | Knex.Transaction, assignment_id: string, data: Partial<ITicketResource>): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();

      // Verify resource exists in the current tenant
      const resource = await knexOrTrx<ITicketResource>('ticket_resources')
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
        const assignedUser = await knexOrTrx('users')
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
        const additionalUser = await knexOrTrx('users')
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

      const updatedCount = await knexOrTrx<ITicketResource>('ticket_resources')
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
