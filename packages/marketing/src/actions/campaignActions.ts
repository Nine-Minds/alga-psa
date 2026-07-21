'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IMarketingCampaign, IMarketingCampaignFunnel } from '@alga-psa/types';
import { guardMarketing } from '../lib/guards';
import {
  createCampaignInternal,
  getCampaignFunnelInternal,
  getCampaignInternal,
  listCampaignsInternal,
  updateCampaignInternal,
} from '../lib/campaigns';
import { campaignInputSchema, campaignUpdateSchema } from '../schemas/marketingSchemas';

export const listMarketingCampaigns = withAuth(async (user, { tenant }): Promise<IMarketingCampaign[]> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return listCampaignsInternal(knex, tenant);
});

export const getMarketingCampaign = withAuth(async (user, { tenant }, campaignId: string): Promise<IMarketingCampaign | null> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return getCampaignInternal(knex, tenant, campaignId);
});

export const createMarketingCampaign = withAuth(async (user, { tenant }, input: unknown): Promise<IMarketingCampaign> => {
  const userId = await guardMarketing(user, tenant, 'manage');
  const data = campaignInputSchema.parse(input);
  const { knex } = await createTenantKnex();
  return createCampaignInternal(knex, tenant, data, userId);
});

export const updateMarketingCampaign = withAuth(async (user, { tenant }, campaignId: string, input: unknown): Promise<IMarketingCampaign> => {
  await guardMarketing(user, tenant, 'manage');
  const data = campaignUpdateSchema.parse(input);
  const { knex } = await createTenantKnex();
  return updateCampaignInternal(knex, tenant, campaignId, data);
});

export const getCampaignFunnel = withAuth(async (user, { tenant }, campaignId: string): Promise<IMarketingCampaignFunnel> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return getCampaignFunnelInternal(knex, tenant, campaignId);
});
