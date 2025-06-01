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
  try {
    const channel = await Channel.get(id);
    return channel;
  } catch (error) {
    console.error(error);
    throw new Error('Failed to find channel');
  }
}

export async function getAllChannels(includeAll: boolean = true): Promise<IChannel[]> {
  try {
    const channels = await Channel.getAll(includeAll);
    return channels;
  } catch (error) {
    console.error('Failed to fetch channels:', error);
    return [];
  }
}

export async function createChannel(channelData: Omit<IChannel, 'channel_id' | 'tenant'>): Promise<IChannel> {
  try {
    channelData.is_inactive = false;
    channelData.is_default = false;
    const newChannel = await Channel.insert(channelData);
    return newChannel;
  } catch (error) {
    console.error('Error creating new channel:', error);
    throw new Error('Failed to create new channel');
  }
}

export async function deleteChannel(channelId: string): Promise<boolean> {
  try {
    await Channel.delete(channelId);
    return true;
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
  try {
    const updatedChannel = await Channel.update(channelId, channelData);
    if (!updatedChannel) {
      throw new Error('Channel not found');
    }
    
    return updatedChannel;
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
