import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IMarketingContent } from '@alga-psa/types';
import type { ContentInput } from '../schemas/marketingSchemas';

export async function listContentInternal(knex: Knex, tenant: string, campaignId?: string): Promise<IMarketingContent[]> {
  const db = tenantDb(knex, tenant);
  const query = db.table('marketing_content').where({ tenant }).orderBy('updated_at', 'desc');
  if (campaignId) query.where('campaign_id', campaignId);
  return query;
}

export async function getContentInternal(knex: Knex, tenant: string, contentId: string): Promise<IMarketingContent | null> {
  const db = tenantDb(knex, tenant);
  return (await db.table('marketing_content').where({ tenant, content_id: contentId }).first()) ?? null;
}

export async function createContentInternal(knex: Knex, tenant: string, input: ContentInput, createdBy: string): Promise<IMarketingContent> {
  const db = tenantDb(knex, tenant);
  const [row] = await db.table('marketing_content')
    .insert({
      tenant,
      title: input.title,
      body_markdown: input.body_markdown ?? '',
      channel_variants: input.channel_variants ?? {},
      campaign_id: input.campaign_id ?? null,
      created_by: createdBy,
    })
    .returning('*');
  return row;
}

export async function updateContentInternal(knex: Knex, tenant: string, contentId: string, input: Partial<ContentInput>): Promise<IMarketingContent> {
  const db = tenantDb(knex, tenant);
  const [row] = await db.table('marketing_content')
    .where({ tenant, content_id: contentId })
    .update({ ...input, updated_at: new Date().toISOString() })
    .returning('*');
  if (!row) throw new Error('Content piece not found');
  return row;
}

export async function deleteContentInternal(knex: Knex, tenant: string, contentId: string): Promise<void> {
  const db = tenantDb(knex, tenant);
  const referenced = await db.table('social_posts').where({ tenant, content_id: contentId }).first('post_id');
  if (referenced) throw new Error('Content is used by scheduled posts and cannot be deleted');
  await db.table('marketing_content').where({ tenant, content_id: contentId }).del();
}
