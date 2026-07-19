'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IMarketingChannel } from '@alga-psa/types';
import { guardMarketing } from '../lib/guards';
import {
  createChannelInternal,
  listChannelsInternal,
  updateChannelInternal,
} from '../lib/channels';
import { channelInputSchema, channelUpdateSchema } from '../schemas/marketingSchemas';

export const listMarketingChannels = withAuth(async (user, { tenant }, activeOnly?: boolean): Promise<IMarketingChannel[]> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return listChannelsInternal(knex, tenant, activeOnly === true);
});

export const createMarketingChannel = withAuth(async (user, { tenant }, input: unknown): Promise<IMarketingChannel> => {
  const userId = await guardMarketing(user, tenant, 'manage');
  const data = channelInputSchema.parse(input);
  const { knex } = await createTenantKnex();
  return createChannelInternal(knex, tenant, data, userId);
});

export const updateMarketingChannel = withAuth(async (user, { tenant }, channelId: string, input: unknown): Promise<IMarketingChannel> => {
  await guardMarketing(user, tenant, 'manage');
  const data = channelUpdateSchema.parse(input);
  const { knex } = await createTenantKnex();
  return updateChannelInternal(knex, tenant, channelId, data);
});
