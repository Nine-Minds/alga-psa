'use server'

import { IChannel } from '../../../interfaces';
import Channel from '../../models/channel';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';

export interface FindChannelByNameOutput {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  is_active: boolean;
}

export async function findChannelById(id: string): Promise<IChannel | undefined> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const channel = await Channel.get(trx, id);
      return channel;
    });
  } catch (error) {
    console.error(error);
    throw new Error('Failed to find channel');
  }
}

export async function getAllChannels(includeAll: boolean = true): Promise<IChannel[]> {
  const { knex: db, tenant } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const channels = await trx('channels')
        .where({ tenant })
        .where(includeAll ? {} : { is_inactive: false })
        .orderBy('display_order', 'asc')
        .orderBy('channel_name', 'asc');
      return channels;
    });
  } catch (error) {
    console.error('Failed to fetch channels:', error);
    return [];
  }
}

export async function createChannel(channelData: Omit<IChannel, 'channel_id' | 'tenant'>): Promise<IChannel> {
  const { knex: db, tenant } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // If no display_order provided, get the next available order
      let displayOrder = channelData.display_order;
      if (displayOrder === undefined || displayOrder === 0) {
        const maxOrder = await trx('channels')
          .where({ tenant })
          .max('display_order as max')
          .first();
        displayOrder = (maxOrder?.max || 0) + 1;
      }

      const [newChannel] = await trx('channels')
        .insert({
          channel_name: channelData.channel_name,
          description: channelData.description || null,
          display_order: displayOrder,
          is_inactive: false,
          is_default: false,
          tenant
        })
        .returning('*');
      
      return newChannel;
    });
  } catch (error) {
    console.error('Error creating new channel:', error);
    throw new Error('Failed to create new channel');
  }
}

export async function deleteChannel(channelId: string): Promise<boolean> {
  const { knex: db } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      await Channel.delete(trx, channelId);
      return true;
    });
  } catch (error) {
    console.error('Error deleting channel:', error);
    if (error instanceof Error) {
      if (error.message.includes('violates foreign key constraint') && error.message.includes('on table "tickets"')) {
        throw new Error('Cannot delete channel: It currently has one or more tickets.');
      }
      throw error;
    }
    throw new Error('Failed to delete channel due to an unexpected error.');
  }
}

export async function updateChannel(channelId: string, channelData: Partial<Omit<IChannel, 'tenant'>>): Promise<IChannel> {
  const { knex: db, tenant } = await createTenantKnex();
  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const [updatedChannel] = await trx('channels')
        .where({ channel_id: channelId, tenant })
        .update(channelData)
        .returning('*');
      
      if (!updatedChannel) {
        throw new Error('Channel not found');
      }
      
      return updatedChannel;
    });
  } catch (error) {
    console.error('Error updating channel:', error);
    // Re-throw the original error to provide specific feedback to the frontend
    if (error instanceof Error) {
      throw error;
    }
    // Fallback for non-Error types (though less likely here)
    throw new Error('Failed to update channel due to an unexpected error.');
  }
}

/**
 * Find channel by name
 * This action searches for existing channels by name
 */
export async function findChannelByName(name: string): Promise<FindChannelByNameOutput | null> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const channel = await trx('channels')
      .select('channel_id as id', 'channel_name as name', 'description', 'is_default', 'is_active')
      .where('tenant', tenant)
      .whereRaw('LOWER(channel_name) = LOWER(?)', [name])
      .first();

    return channel || null;
  });
}
