import { Knex } from 'knex';
import { IStatus } from '../../interfaces/status.interface';
import { getCurrentTenantId } from '../db';

const Status = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction): Promise<IStatus[]> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        console.error('Tenant context is required for getting statuses');
        throw new Error('Tenant context is required for getting statuses');
      }

      const statuses = await knexOrTrx<IStatus>('statuses')
        .select('*')
        .where({ tenant });
        
      return statuses;
    } catch (error) {
      console.error('Error getting all statuses:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<IStatus | undefined> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      console.error('Tenant context is required for getting status');
      throw new Error('Tenant context is required for getting status');
    }

    try {
      const status = await knexOrTrx<IStatus>('statuses')
        .select('*')
        .where({
          status_id: id,
          tenant
        })
        .first();
      return status;
    } catch (error) {
      console.error(`Error getting status with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, status: Omit<IStatus, 'tenant'>): Promise<Pick<IStatus, "status_id">> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      throw new Error('Tenant context is required for creating status');
    }

    try {
      // Check if this is the first status of this type - if so, make it default
      const existingStatuses = await knexOrTrx<IStatus>('statuses')
        .where({ 
          tenant, 
          status_type: status.status_type,
          is_default: true 
        });

      // Get the max order number for this status type
      const maxOrderResult = await knexOrTrx('statuses')
        .max('order_number as maxOrder')
        .where({
          tenant,
          status_type: status.status_type
        })
        .first<{ maxOrder: number | null }>();

      const nextOrderNumber = (maxOrderResult?.maxOrder || 0) + 1;

      const statusToInsert = {
        ...status,
        tenant,
        order_number: nextOrderNumber,
        is_default: existingStatuses.length === 0 // Make default if no other default exists for this type
      };

      const [insertedStatus] = await knexOrTrx<IStatus>('statuses')
        .insert(statusToInsert)
        .returning('status_id');
      
      return { status_id: insertedStatus.status_id };
    } catch (error) {
      console.error('Error inserting status:', error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, id: string, status: Partial<IStatus>): Promise<IStatus> => {
    const tenant = await getCurrentTenantId();
    
    if (!tenant) {
      console.error('Tenant context is required for updating status');
      throw new Error('Tenant context is required for updating status');
    }

    try {
      // Remove tenant from update data to prevent modification
      const { tenant: _, ...updateData } = status;

      // If updating is_default to false, check if this is the last default status
      if (updateData.is_default === false) {
        const currentStatus = await knexOrTrx<IStatus>('statuses')
          .where({ tenant, status_id: id })
          .first();

        if (currentStatus) {
          const defaultStatuses = await knexOrTrx<IStatus>('statuses')
            .where({ 
              tenant, 
              is_default: true,
              status_type: currentStatus.status_type // Only check statuses of the same type
            })
            .whereNot('status_id', id);
          
          if (defaultStatuses.length === 0) {
            throw new Error('Cannot remove default status from the last default status');
          }
        }
      }

      await knexOrTrx<IStatus>('statuses')
        .where({
          status_id: id,
          tenant
        })
        .update(updateData);

      const updatedStatus = await knexOrTrx<IStatus>('statuses')
        .where({
          status_id: id,
          tenant
        })
        .first();

      if (!updatedStatus) {
        throw new Error(`Status with id ${id} not found after update`);
      }

      return updatedStatus;
    } catch (error) {
      console.error(`Error updating status with id ${id}:`, error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        console.error('Tenant context is required for deleting status');
        throw new Error('Tenant context is required for deleting status');
      }

      // Check if this is a default status
      const status = await knexOrTrx<IStatus>('statuses')
        .where({ 
          status_id: id,
          tenant,
          is_default: true
        })
        .first();

      if (status) {
        throw new Error('Cannot delete the default status');
      }

      const result = await knexOrTrx<IStatus>('statuses')
        .where({
          status_id: id,
          tenant
        })
        .del();
      
      if (result === 0) {
        throw new Error(`Status with id ${id} not found or belongs to different tenant`);
      }
    } catch (error) {
      console.error(`Error deleting status with id ${id}:`, error);
      throw error;
    }
  }
};

export default Status;
