import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IMarketingChannel } from '@alga-psa/types';
import type { ChannelInput } from '../schemas/marketingSchemas';

export async function listChannelsInternal(knex: Knex, tenant: string, activeOnly = false): Promise<IMarketingChannel[]> {
  const db = tenantDb(knex, tenant);
  const query = db.table('marketing_channels').where({ tenant }).orderBy('name', 'asc');
  if (activeOnly) query.where('is_active', true);
  return query;
}

export async function createChannelInternal(knex: Knex, tenant: string, input: ChannelInput, createdBy: string): Promise<IMarketingChannel> {
  const db = tenantDb(knex, tenant);
  const [row] = await db.table('marketing_channels')
    .insert({
      tenant,
      name: input.name,
      platform: input.platform,
      handle_or_url: input.handle_or_url ?? null,
      is_active: input.is_active ?? true,
      created_by: createdBy,
    })
    .returning('*');
  return row;
}

export async function updateChannelInternal(knex: Knex, tenant: string, channelId: string, input: Partial<ChannelInput>): Promise<IMarketingChannel> {
  const db = tenantDb(knex, tenant);
  const [row] = await db.table('marketing_channels')
    .where({ tenant, channel_id: channelId })
    .update({ ...input, updated_at: new Date().toISOString() })
    .returning('*');
  if (!row) throw new Error('Channel not found');
  return row;
}
