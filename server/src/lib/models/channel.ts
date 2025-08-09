import { getCurrentTenantId } from '../db';
import { Knex } from 'knex';
import { IChannel } from '../../interfaces/channel.interface';

const Channel = {
  getAll: async (knexOrTrx: Knex | Knex.Transaction, includeAll: boolean = false): Promise<IChannel[]> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
      let query = knexOrTrx<IChannel>('channels')
        .select('*')
        .where('tenant', tenant);
      if (!includeAll) {
        query = query.andWhere('is_inactive', false);
      }
      const channels = await query;
      return channels;
    } catch (error) {
      console.error('Error getting all channels:', error);
      throw error;
    }
  },

  get: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<IChannel | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      if (!tenant) {
        throw new Error('Tenant context is required');
      }
      
      const channel = await knexOrTrx<IChannel>('channels')
        .select('*')
        .where('channel_id', id)
        .andWhere('tenant', tenant)
        .first();
      return channel;
    } catch (error) {
      console.error(`Error getting channel with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (knexOrTrx: Knex | Knex.Transaction, channel: Omit<IChannel, 'channel_id' | 'tenant'>): Promise<IChannel> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for creating board');
      }

      // Check if this is the first channel - if so, make it default
      const existingChannels = await knexOrTrx('channels')
        .where({ tenant, is_default: true });

      const channelToInsert = {
        ...channel,
        tenant,
        is_inactive: false,
        is_default: existingChannels.length === 0 // Make default if no other default exists
      };

      const [insertedChannel] = await knexOrTrx('channels').insert(channelToInsert).returning('*');
      return insertedChannel;
    } catch (error) {
      console.error('Error inserting channel:', error);
      throw error;
    }
  },

  delete: async (knexOrTrx: Knex | Knex.Transaction, id: string): Promise<void> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for deleting board');
      }

      // Check if this is a default channel
      const channel = await knexOrTrx<IChannel>('channels')
        .where({ 
          channel_id: id,
          tenant,
          is_default: true
        })
        .first();

      if (channel) {
        throw new Error('Cannot delete the default board');
      }

      await knexOrTrx<IChannel>('channels')
        .where('channel_id', id)
        .andWhere('tenant', tenant)
        .del();
    } catch (error) {
      console.error(`Error deleting channel with id ${id}:`, error);
      throw error;
    }
  },

  update: async (knexOrTrx: Knex | Knex.Transaction, id: string, updates: Partial<Omit<IChannel, 'tenant'>>): Promise<IChannel | undefined> => {
    try {
      const tenant = await getCurrentTenantId();
      
      if (!tenant) {
        throw new Error('Tenant context is required for updating board');
      }

      // If updating is_default to false, check if this is the last default channel
      if (updates.is_default === false) {
        const defaultChannels = await knexOrTrx('channels')
          .where({ tenant, is_default: true })
          .whereNot('channel_id', id);
        
        if (defaultChannels.length === 0) {
          throw new Error('Cannot remove default status from the last default board');
        }
      }

      // If setting as default, unset all other defaults first
      if (updates.is_default === true) {
        await knexOrTrx('channels')
          .where({ tenant, is_default: true })
          .update({ is_default: false });
      }

      const [updatedChannel] = await knexOrTrx('channels')
        .where('channel_id', id)
        .andWhere('tenant', tenant)
        .update(updates)
        .returning('*');

      return updatedChannel;
    } catch (error) {
      console.error(`Error updating channel with id ${id}:`, error);
      throw error;
    }
  },

}

export default Channel;