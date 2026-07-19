'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IMarketingContent } from '@alga-psa/types';
import { guardMarketing } from '../lib/guards';
import {
  createContentInternal,
  deleteContentInternal,
  getContentInternal,
  listContentInternal,
  updateContentInternal,
} from '../lib/content';
import { contentInputSchema, contentUpdateSchema } from '../schemas/marketingSchemas';

export const listMarketingContent = withAuth(async (user, { tenant }, campaignId?: string): Promise<IMarketingContent[]> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return listContentInternal(knex, tenant, campaignId);
});

export const getMarketingContent = withAuth(async (user, { tenant }, contentId: string): Promise<IMarketingContent | null> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return getContentInternal(knex, tenant, contentId);
});

export const createMarketingContent = withAuth(async (user, { tenant }, input: unknown): Promise<IMarketingContent> => {
  const userId = await guardMarketing(user, tenant, 'manage');
  const data = contentInputSchema.parse(input);
  const { knex } = await createTenantKnex();
  return createContentInternal(knex, tenant, data, userId);
});

export const updateMarketingContent = withAuth(async (user, { tenant }, contentId: string, input: unknown): Promise<IMarketingContent> => {
  await guardMarketing(user, tenant, 'manage');
  const data = contentUpdateSchema.parse(input);
  const { knex } = await createTenantKnex();
  return updateContentInternal(knex, tenant, contentId, data);
});

export const deleteMarketingContent = withAuth(async (user, { tenant }, contentId: string): Promise<void> => {
  await guardMarketing(user, tenant, 'manage');
  const { knex } = await createTenantKnex();
  return deleteContentInternal(knex, tenant, contentId);
});
