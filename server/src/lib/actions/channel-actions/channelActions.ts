'use server'

import { IChannel } from '../../../interfaces';
import Channel from '../../models/channel';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { ItilStandardsService } from '../../services/itilStandardsService';
import { getCurrentUser } from '../user-actions/userActions';

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
    throw new Error('Failed to find board');
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
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

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

      // Check if we should set as default
      let isDefault = channelData.is_default || false;
      if (isDefault) {
        // Check if there's already a default channel
        const existingDefault = await trx('channels')
          .where({ tenant, is_default: true })
          .first();
        
        if (existingDefault) {
          // Unset the existing default
          await trx('channels')
            .where({ tenant, is_default: true })
            .update({ is_default: false });
        }
      }
      
      const [newChannel] = await trx('channels')
        .insert({
          channel_name: channelData.channel_name,
          description: channelData.description || null,
          display_order: displayOrder,
          is_inactive: channelData.is_inactive || false,
          is_default: isDefault,
          category_type: channelData.category_type || 'custom',
          priority_type: channelData.priority_type || 'custom',
          display_itil_impact: channelData.display_itil_impact || false,
          display_itil_urgency: channelData.display_itil_urgency || false,
          tenant
        })
        .returning('*');

      // If ITIL types are configured, copy the standards to tenant tables
      await ItilStandardsService.handleItilConfiguration(
        trx,
        tenant,
        user.user_id,
        newChannel.channel_id,
        channelData.category_type,
        channelData.priority_type
      );

      return newChannel;
    });
  } catch (error) {
    console.error('Error creating new channel:', error);
    throw new Error('Failed to create new board');
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
        throw new Error('Cannot delete board: It currently has one or more tickets.');
      }
      throw error;
    }
    throw new Error('Failed to delete board due to an unexpected error.');
  }
}

export async function updateChannel(channelId: string, channelData: Partial<Omit<IChannel, 'tenant'>>): Promise<IChannel> {
  const { knex: db, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get the current channel to check for ITIL type changes
      const currentChannel = await trx('channels')
        .where({ channel_id: channelId, tenant })
        .first();

      if (!currentChannel) {
        throw new Error('Board not found');
      }

      // If setting as default, unset all other defaults first
      if (channelData.is_default === true) {
        await trx('channels')
          .where({ tenant, is_default: true })
          .whereNot('channel_id', channelId)
          .update({ is_default: false });
      }

      const [updatedChannel] = await trx('channels')
        .where({ channel_id: channelId, tenant })
        .update(channelData)
        .returning('*');

      // Handle ITIL type changes
      const categoryTypeChanged = channelData.category_type && channelData.category_type !== currentChannel.category_type;
      const priorityTypeChanged = channelData.priority_type && channelData.priority_type !== currentChannel.priority_type;

      if (categoryTypeChanged || priorityTypeChanged) {
        // If switching to ITIL, copy the standards
        await ItilStandardsService.handleItilConfiguration(
          trx,
          tenant,
          user.user_id,
          channelId,
          channelData.category_type || currentChannel.category_type,
          channelData.priority_type || currentChannel.priority_type
        );

        // If switching away from ITIL, clean up unused standards
        if ((categoryTypeChanged && currentChannel.category_type === 'itil') ||
            (priorityTypeChanged && currentChannel.priority_type === 'itil')) {
          await ItilStandardsService.cleanupUnusedItilStandards(trx, tenant);
        }
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
    throw new Error('Failed to update board due to an unexpected error.');
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
