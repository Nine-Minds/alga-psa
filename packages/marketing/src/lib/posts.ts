import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type {
  MarketingExpireStaleTargetsSummary,
  MarketingFlipDuePostsSummary,
} from './marketingJobContract';
import type {
  ISocialPost,
  ISocialPostQueueItem,
  ISocialPostTarget,
  SocialPostStatus,
} from '@alga-psa/types';
import { renderPostText } from './render';
import { recordMarketingEngagement } from './engagements';
import type { QueueFilters } from '../schemas/marketingSchemas';

type Db = Knex | Knex.Transaction;

/**
 * Post status is a rollup of its targets' states (targets are authoritative):
 *   any awaiting      -> awaiting-manual-publish
 *   any published     -> published   (remaining targets may still be worked)
 *   all terminal, none published -> expired
 *   otherwise         -> scheduled
 */
export async function rollupPostStatus(db: Db, tenant: string, postId: string): Promise<SocialPostStatus> {
  const tdb = tenantDb(db, tenant);
  const targets = await tdb.table('social_post_targets')
    .where({ tenant, post_id: postId })
    .select('status') as Array<{ status: string }>;

  const statuses = targets.map((t) => t.status);
  let status: SocialPostStatus;
  if (statuses.some((s) => s === 'awaiting-manual-publish')) status = 'awaiting-manual-publish';
  else if (statuses.some((s) => s === 'published')) status = 'published';
  else if (statuses.length > 0 && statuses.every((s) => s === 'skipped' || s === 'expired')) status = 'expired';
  else status = 'scheduled';

  await tdb.table('social_posts')
    .where({ tenant, post_id: postId })
    .update({ status, updated_at: new Date().toISOString() });
  return status;
}

export async function createPostInternal(
  knex: Knex,
  tenant: string,
  input: {
    content_id: string;
    campaign_id?: string | null;
    channel_ids: string[];
    scheduled_at?: string | null;
    created_by: string;
  },
): Promise<ISocialPost> {
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);

    const content = await db.table('marketing_content')
      .where({ tenant, content_id: input.content_id })
      .first('content_id', 'campaign_id');
    if (!content) throw new Error('Content piece not found');

    if (input.campaign_id) {
      const campaign = await db.table('marketing_campaigns')
        .where({ tenant, campaign_id: input.campaign_id })
        .first('campaign_id');
      if (!campaign) throw new Error('Campaign not found');
    }

    const channels = await db.table('marketing_channels')
      .where({ tenant, is_active: true })
      .whereIn('channel_id', input.channel_ids)
      .select('channel_id');
    if (channels.length !== input.channel_ids.length) {
      throw new Error('One or more channels are missing or inactive');
    }

    const scheduledAt = input.scheduled_at ?? null;
    const [post] = await db.table('social_posts')
      .insert({
        tenant,
        content_id: input.content_id,
        campaign_id: input.campaign_id ?? content.campaign_id ?? null,
        status: scheduledAt ? 'scheduled' : 'draft',
        scheduled_at: scheduledAt,
        created_by: input.created_by,
      })
      .returning('*');

    await db.table('social_post_targets')
      .insert(channels.map((channel) => ({
        tenant,
        post_id: post.post_id,
        channel_id: channel.channel_id,
        status: 'scheduled',
      })));

    return post as ISocialPost;
  });
}

export async function reschedulePostInternal(
  knex: Knex,
  tenant: string,
  postId: string,
  scheduledAt: string,
): Promise<void> {
  await withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    // awaiting-manual-publish is the "I'll publish this tomorrow" case:
    // rescheduling flips the waiting targets back to scheduled so the flip
    // job picks them up again at the new time.
    const now = new Date().toISOString();
    const updated = await db.table('social_posts')
      .where({ tenant, post_id: postId })
      .whereIn('status', ['draft', 'scheduled', 'awaiting-manual-publish'])
      .update({ scheduled_at: scheduledAt, status: 'scheduled', updated_at: now });
    if (!updated) throw new Error('Post cannot be rescheduled in its current state');

    await db.table('social_post_targets')
      .where({ tenant, post_id: postId, status: 'awaiting-manual-publish' })
      .update({ status: 'scheduled', updated_at: now });
    await rollupPostStatus(trx, tenant, postId);
  });
}

/**
 * Due-flip job body: targets still in 'scheduled' on posts whose scheduled_at
 * has passed move to awaiting-manual-publish. Driven off target state (the
 * authoritative machine), not the rolled-up post status — a sibling target
 * published early rolls the post to 'published' without hiding the remaining
 * scheduled targets from this job. Idempotent — only touches rows still in
 * 'scheduled', so re-runs are no-ops.
 */
export async function flipDuePostsInternal(
  knex: Knex,
  tenant: string,
  now: Date = new Date(),
): Promise<MarketingFlipDuePostsSummary> {
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const dueTargets = await db.table('social_post_targets as t')
      .join('social_posts as p', function joinPost() {
        this.on('p.tenant', '=', 't.tenant').andOn('p.post_id', '=', 't.post_id');
      })
      .where({ 't.tenant': tenant, 't.status': 'scheduled' })
      .whereNot('p.status', 'draft')
      .whereNotNull('p.scheduled_at')
      .where('p.scheduled_at', '<=', now.toISOString())
      .select('t.target_id', 't.post_id') as Array<{ target_id: string; post_id: string }>;

    let flipped = 0;
    if (dueTargets.length > 0) {
      flipped = await db.table('social_post_targets')
        .where({ tenant, status: 'scheduled' })
        .whereIn('target_id', dueTargets.map((t) => t.target_id))
        .update({ status: 'awaiting-manual-publish', updated_at: now.toISOString() });
      for (const postId of new Set(dueTargets.map((t) => t.post_id))) {
        await rollupPostStatus(trx, tenant, postId);
      }
    }
    return { flipped };
  });
}

/** Grace-period job body: stale awaiting targets flip to expired. Idempotent. */
export async function expireStaleTargetsInternal(
  knex: Knex,
  tenant: string,
  graceHours: number,
  now: Date = new Date(),
): Promise<MarketingExpireStaleTargetsSummary> {
  const cutoff = new Date(now.getTime() - graceHours * 3_600_000).toISOString();
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const stale = await db.table('social_post_targets as t')
      .join('social_posts as p', function joinPost() {
        this.on('p.tenant', '=', 't.tenant').andOn('p.post_id', '=', 't.post_id');
      })
      .where({ 't.tenant': tenant, 't.status': 'awaiting-manual-publish' })
      .where('t.updated_at', '<=', cutoff)
      .select('t.target_id', 't.post_id');

    for (const row of stale) {
      await db.table('social_post_targets')
        .where({ tenant, target_id: row.target_id, status: 'awaiting-manual-publish' })
        .update({ status: 'expired', updated_at: now.toISOString() });
      await rollupPostStatus(trx, tenant, row.post_id);
    }
    return { expired: stale.length };
  });
}

export async function markTargetPublishedInternal(
  knex: Knex,
  tenant: string,
  targetId: string,
  input: { permalink?: string | null; publishedBy: string; publishedVia: 'ui' | 'api' | 'mcp' },
): Promise<ISocialPostTarget> {
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    // The state check lives in the UPDATE's WHERE: concurrent publishers
    // (UI + MCP agent) race on the row itself, so only the one that actually
    // transitions it records the engagement — and a just-expired/skipped
    // target can never be overwritten.
    const now = new Date().toISOString();
    const [updated] = await db.table('social_post_targets')
      .where({ tenant, target_id: targetId })
      .whereIn('status', ['awaiting-manual-publish', 'scheduled'])
      .update({
        status: 'published',
        permalink: input.permalink ?? null,
        published_at: now,
        published_by: input.publishedBy,
        published_via: input.publishedVia,
        updated_at: now,
      })
      .returning('*');

    if (!updated) {
      const target = await db.table('social_post_targets')
        .where({ tenant, target_id: targetId })
        .first();
      if (!target) throw new Error('Post target not found');
      if (target.status === 'published') return target as ISocialPostTarget; // idempotent replay
      throw new Error(`Target cannot be published from state ${target.status}`);
    }

    const post = await db.table('social_posts')
      .where({ tenant, post_id: updated.post_id })
      .first('post_id', 'content_id', 'campaign_id');
    await recordMarketingEngagement(trx, tenant, {
      typeName: 'Marketing: Post Published',
      title: 'Social post published',
      notes: input.permalink ? `Permalink: ${input.permalink}` : null,
      contactId: null,
      clientId: null,
      userId: input.publishedBy,
      campaignId: post?.campaign_id ?? null,
      contentId: post?.content_id ?? null,
      postId: updated.post_id,
      occurredAt: now,
    });

    await rollupPostStatus(trx, tenant, updated.post_id);
    return updated as ISocialPostTarget;
  });
}

export async function skipTargetInternal(
  knex: Knex,
  tenant: string,
  targetId: string,
): Promise<ISocialPostTarget> {
  return withTransaction(knex, async (trx) => {
    const db = tenantDb(trx, tenant);
    const [updated] = await db.table('social_post_targets')
      .where({ tenant, target_id: targetId })
      .whereIn('status', ['scheduled', 'awaiting-manual-publish'])
      .update({ status: 'skipped', updated_at: new Date().toISOString() })
      .returning('*');
    if (!updated) throw new Error('Target cannot be skipped in its current state');
    await rollupPostStatus(trx, tenant, updated.post_id);
    return updated as ISocialPostTarget;
  });
}

function toQueueItem(row: Record<string, any>): ISocialPostQueueItem {
  const variants = (row.channel_variants ?? {}) as Record<string, string>;
  return {
    tenant: String(row.tenant),
    target_id: String(row.target_id),
    post_id: String(row.post_id),
    channel_id: String(row.channel_id),
    status: row.status,
    permalink: row.permalink ?? null,
    published_at: row.published_at ?? null,
    published_by: row.published_by ?? null,
    published_via: row.published_via ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    post_status: row.post_status,
    scheduled_at: row.scheduled_at ?? null,
    content_title: row.content_title,
    content_body_markdown: row.content_body_markdown,
    channel_variants: variants,
    channel_name: row.channel_name,
    channel_platform: row.channel_platform,
    channel_handle_or_url: row.channel_handle_or_url ?? null,
    campaign_id: row.campaign_id ?? null,
    campaign_name: row.campaign_name ?? null,
    rendered_text: renderPostText(
      { body_markdown: row.content_body_markdown, channel_variants: variants },
      row.channel_platform,
    ),
  };
}

function queueQuery(db: ReturnType<typeof tenantDb>, tenant: string) {
  return db.table('social_post_targets as t')
    .join('social_posts as p', function joinPost() {
      this.on('p.tenant', '=', 't.tenant').andOn('p.post_id', '=', 't.post_id');
    })
    .join('marketing_content as c', function joinContent() {
      this.on('c.tenant', '=', 'p.tenant').andOn('c.content_id', '=', 'p.content_id');
    })
    .join('marketing_channels as ch', function joinChannel() {
      this.on('ch.tenant', '=', 't.tenant').andOn('ch.channel_id', '=', 't.channel_id');
    })
    .leftJoin('marketing_campaigns as camp', function joinCampaign() {
      this.on('camp.tenant', '=', 'p.tenant').andOn('camp.campaign_id', '=', 'p.campaign_id');
    })
    .where('t.tenant', tenant)
    .select(
      't.*',
      'p.status as post_status',
      'p.scheduled_at',
      'p.campaign_id',
      'c.title as content_title',
      'c.body_markdown as content_body_markdown',
      'c.channel_variants',
      'ch.name as channel_name',
      'ch.platform as channel_platform',
      'ch.handle_or_url as channel_handle_or_url',
      'camp.name as campaign_name',
    );
}

export async function getQueueInternal(
  knex: Knex,
  tenant: string,
  filters: QueueFilters = {},
): Promise<ISocialPostQueueItem[]> {
  const db = tenantDb(knex, tenant);
  const query = queueQuery(db, tenant);
  if (filters.status) query.where('t.status', filters.status);
  if (filters.channel_id) query.where('t.channel_id', filters.channel_id);
  if (filters.campaign_id) query.where('p.campaign_id', filters.campaign_id);
  if (filters.date_from) query.where('p.scheduled_at', '>=', filters.date_from);
  if (filters.date_to) query.where('p.scheduled_at', '<=', filters.date_to);
  const rows = await query.orderBy([
    { column: 'p.scheduled_at', order: 'asc', nulls: 'last' },
    { column: 't.created_at', order: 'asc' },
  ]);
  return rows.map(toQueueItem);
}

/** The agent publish loop's reading list: everything waiting for a human or
 *  an MCP agent to publish on the platform. */
export async function getAwaitingPublishInternal(
  knex: Knex,
  tenant: string,
): Promise<ISocialPostQueueItem[]> {
  return getQueueInternal(knex, tenant, { status: 'awaiting-manual-publish' });
}

/** Calendar view: everything with a scheduled date in range, any state. */
export async function getCalendarItemsInternal(
  knex: Knex,
  tenant: string,
  dateFrom: string,
  dateTo: string,
): Promise<ISocialPostQueueItem[]> {
  return getQueueInternal(knex, tenant, { date_from: dateFrom, date_to: dateTo });
}
