import { createTenantKnex } from '../db';
import { IChannel } from '../../interfaces/channel.interface';

const Channel = {
  getAll: async (includeAll: boolean = false): Promise<IChannel[]> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      let query = db<IChannel>('channels')
        .select('*')
        .where('tenant', tenant!);
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

  get: async (id: string): Promise<IChannel | undefined> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      const channel = await db<IChannel>('channels')
        .select('*')
        .where('channel_id', id)
        .andWhere('tenant', tenant!)
        .first();
      return channel;
    } catch (error) {
      console.error(`Error getting channel with id ${id}:`, error);
      throw error;
    }
  },

  insert: async (channel: Omit<IChannel, 'channel_id' | 'tenant'>): Promise<IChannel> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      const channelToInsert = {
        ...channel,
        tenant: tenant!,
        is_inactive: false
      };
      const [insertedChannel] = await knex('channels').insert(channelToInsert).returning('*');
      return insertedChannel;
    } catch (error) {
      console.error('Error inserting channel:', error);
      throw error;
    }
  },

  delete: async (id: string): Promise<void> => {
    try {
      const {knex: db, tenant} = await createTenantKnex();
      await db<IChannel>('channels')
        .where('channel_id', id)
        .andWhere('tenant', tenant!)
        .del();
    } catch (error) {
      console.error(`Error deleting channel with id ${id}:`, error);
      throw error;
    }
  },

  update: async (id: string, updates: Partial<Omit<IChannel, 'tenant'>>): Promise<IChannel | undefined> => {
    try {
      const { knex, tenant } = await createTenantKnex();
      const [updatedChannel] = await knex('channels')
        .where('channel_id', id)
        .andWhere('tenant', tenant!)
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
