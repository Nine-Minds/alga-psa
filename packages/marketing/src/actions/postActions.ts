'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { ISocialPost, ISocialPostQueueItem, ISocialPostTarget } from '@alga-psa/types';
import { guardMarketing } from '../lib/guards';
import {
  createPostInternal,
  getAwaitingPublishInternal,
  getCalendarItemsInternal,
  getQueueInternal,
  markTargetPublishedInternal,
  reschedulePostInternal,
  skipTargetInternal,
} from '../lib/posts';
import {
  markPublishedSchema,
  postCreateSchema,
  postRescheduleSchema,
  queueFiltersSchema,
} from '../schemas/marketingSchemas';

export const createSocialPost = withAuth(async (user, { tenant }, input: unknown): Promise<ISocialPost> => {
  const userId = await guardMarketing(user, tenant, 'manage');
  const data = postCreateSchema.parse(input);
  const { knex } = await createTenantKnex();
  return createPostInternal(knex, tenant, { ...data, created_by: userId });
});

export const rescheduleSocialPost = withAuth(async (user, { tenant }, postId: string, input: unknown): Promise<void> => {
  await guardMarketing(user, tenant, 'manage');
  const data = postRescheduleSchema.parse(input);
  const { knex } = await createTenantKnex();
  return reschedulePostInternal(knex, tenant, postId, data.scheduled_at);
});

export const getSocialPostQueue = withAuth(async (user, { tenant }, filters?: unknown): Promise<ISocialPostQueueItem[]> => {
  await guardMarketing(user, tenant, 'read');
  const data = queueFiltersSchema.parse(filters ?? {});
  const { knex } = await createTenantKnex();
  return getQueueInternal(knex, tenant, data);
});

export const getAwaitingPublishQueue = withAuth(async (user, { tenant }): Promise<ISocialPostQueueItem[]> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return getAwaitingPublishInternal(knex, tenant);
});

export const getMarketingCalendarItems = withAuth(async (user, { tenant }, dateFrom: string, dateTo: string): Promise<ISocialPostQueueItem[]> => {
  await guardMarketing(user, tenant, 'read');
  const { knex } = await createTenantKnex();
  return getCalendarItemsInternal(knex, tenant, dateFrom, dateTo);
});

export const markTargetPublished = withAuth(async (user, { tenant }, targetId: string, input: unknown): Promise<ISocialPostTarget> => {
  const userId = await guardMarketing(user, tenant, 'manage');
  const data = markPublishedSchema.parse(input);
  const { knex } = await createTenantKnex();
  return markTargetPublishedInternal(knex, tenant, targetId, {
    permalink: data.permalink,
    publishedBy: userId,
    publishedVia: 'ui',
  });
});

export const skipPostTarget = withAuth(async (user, { tenant }, targetId: string): Promise<ISocialPostTarget> => {
  await guardMarketing(user, tenant, 'manage');
  const { knex } = await createTenantKnex();
  return skipTargetInternal(knex, tenant, targetId);
});
