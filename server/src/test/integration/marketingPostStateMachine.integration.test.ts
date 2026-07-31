/**
 * T008 — social post state machine.
 *
 * A post scheduled in the past flips scheduled -> awaiting-manual-publish at
 * due time (targets are authoritative; the post status is a rollup). The
 * flip job is idempotent: a re-run moves nothing and records nothing.
 * markTargetPublishedInternal records permalink + published_by/published_via
 * and logs a 'Marketing: Post Published' interaction; replaying it is an
 * idempotent early return (no second interaction). A target that sits in
 * awaiting-manual-publish past the grace period auto-expires.
 *
 * Requires the standard test DB; skipped automatically when no database is
 * reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

import { createContentInternal } from '../../../../packages/marketing/src/lib/content';
import { createChannelInternal } from '../../../../packages/marketing/src/lib/channels';
import {
  createPostInternal,
  flipDuePostsInternal,
  expireStaleTargetsInternal,
  markTargetPublishedInternal,
} from '../../../../packages/marketing/src/lib/posts';

const describeDb = await describeWithDb();
const requireCjs = createRequire(import.meta.url);

let db: Knex;
let tenantId: string;
let userId: string;

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

describeDb('T008: social post state machine', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Marketing Posts Tenant');
    userId = await createUser(db, tenantId, { username: 'marketing.posts.test' });

    const seedTypes = requireCjs('../../../migrations/20260719103000_seed_marketing_interaction_types.cjs');
    await seedTypes.up(db);
  }, 120_000);

  afterAll(async () => {
    await db?.destroy();
  });

  it('flips due targets, publishes idempotently, and expires stale targets', async () => {
    const content = await createContentInternal(db, tenantId, {
      title: 'Launch announcement',
      body_markdown: 'We shipped a thing',
      channel_variants: {},
    }, userId);
    const linkedin = await createChannelInternal(db, tenantId, { name: 'LinkedIn', platform: 'linkedin' }, userId);
    const mastodon = await createChannelInternal(db, tenantId, { name: 'Mastodon', platform: 'mastodon' }, userId);

    // Baseline-relative counting: the suite shuffles, and sibling tests
    // record their own 'Post Published' interactions.
    const publishedType = await db('system_interaction_types')
      .where({ type_name: 'Marketing: Post Published' })
      .first('type_id');
    const publishCount = async () =>
      (await tenantTable('interactions').where({ tenant: tenantId, type_id: publishedType.type_id })).length;
    const baselinePublished = await publishCount();

    const scheduledAt = new Date(Date.now() - 60 * 60_000).toISOString(); // one hour ago: due
    const post = await createPostInternal(db, tenantId, {
      content_id: content.content_id,
      channel_ids: [linkedin.channel_id, mastodon.channel_id],
      scheduled_at: scheduledAt,
      created_by: userId,
    });
    expect(post.status).toBe('scheduled');

    // Due-flip: both targets move to awaiting-manual-publish, rollup follows.
    const firstFlip = await flipDuePostsInternal(db, tenantId, new Date());
    expect(firstFlip).toEqual({ flipped: 2 });

    const targetsAfterFlip = await tenantTable('social_post_targets')
      .where({ tenant: tenantId, post_id: post.post_id })
      .orderBy('channel_id', 'asc');
    expect(targetsAfterFlip.map((t: { status: string }) => t.status)).toEqual([
      'awaiting-manual-publish',
      'awaiting-manual-publish',
    ]);
    const postAfterFlip = await tenantTable('social_posts')
      .where({ tenant: tenantId, post_id: post.post_id })
      .first();
    expect(postAfterFlip.status).toBe('awaiting-manual-publish');

    // Re-run is a no-op: nothing left in 'scheduled', and the flip never
    // records interactions in the first place.
    const secondFlip = await flipDuePostsInternal(db, tenantId, new Date());
    expect(secondFlip).toEqual({ flipped: 0 });
    expect(await publishCount()).toBe(baselinePublished);

    // Publish one target with a permalink.
    const targetToPublish = targetsAfterFlip[0];
    const published = await markTargetPublishedInternal(db, tenantId, targetToPublish.target_id, {
      permalink: 'https://linkedin.com/posts/launch-1',
      publishedBy: userId,
      publishedVia: 'ui',
    });
    expect(published).toMatchObject({
      status: 'published',
      permalink: 'https://linkedin.com/posts/launch-1',
      published_by: userId,
      published_via: 'ui',
    });
    expect(published.published_at).toBeTruthy();

    const publishInteraction = await tenantTable('interactions')
      .where({ tenant: tenantId, type_id: publishedType.type_id, notes: 'Permalink: https://linkedin.com/posts/launch-1' })
      .first();
    expect(publishInteraction).toMatchObject({
      title: 'Social post published',
      notes: 'Permalink: https://linkedin.com/posts/launch-1',
      user_id: userId,
    });
    const publishEngagement = await tenantTable('marketing_engagements')
      .where({ tenant: tenantId, interaction_id: publishInteraction.interaction_id })
      .first();
    expect(publishEngagement).toMatchObject({
      post_id: post.post_id,
      content_id: content.content_id,
    });

    // Idempotent replay: early return, no second interaction.
    const replayed = await markTargetPublishedInternal(db, tenantId, targetToPublish.target_id, {
      permalink: 'https://linkedin.com/posts/launch-1',
      publishedBy: userId,
      publishedVia: 'ui',
    });
    expect(replayed.status).toBe('published');
    expect(await publishCount()).toBe(baselinePublished + 1);

    // The other target sits awaiting well past the 48h grace period.
    const staleTarget = targetsAfterFlip[1];
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 3_600_000).toISOString();
    await tenantTable('social_post_targets')
      .where({ tenant: tenantId, target_id: staleTarget.target_id })
      .update({ updated_at: seventyTwoHoursAgo });

    const expired = await expireStaleTargetsInternal(db, tenantId, 48, new Date());
    expect(expired).toEqual({ expired: 1 });

    const staleAfter = await tenantTable('social_post_targets')
      .where({ tenant: tenantId, target_id: staleTarget.target_id })
      .first();
    expect(staleAfter.status).toBe('expired');

    // Rollup: one published target + one expired target => published post.
    const finalPost = await tenantTable('social_posts')
      .where({ tenant: tenantId, post_id: post.post_id })
      .first();
    expect(finalPost.status).toBe('published');

    // Expiry is idempotent too: nothing left awaiting past grace.
    const expireRerun = await expireStaleTargetsInternal(db, tenantId, 48, new Date());
    expect(expireRerun).toEqual({ expired: 0 });
  });

  it('M2: an early-published sibling does not hide remaining scheduled targets from the flip job', async () => {
    const content = await createContentInternal(db, tenantId, {
      title: 'Early publish',
      body_markdown: 'One target jumps the gun',
      channel_variants: {},
    }, userId);
    const chanA = await createChannelInternal(db, tenantId, { name: 'Chan A', platform: 'linkedin' }, userId);
    const chanB = await createChannelInternal(db, tenantId, { name: 'Chan B', platform: 'mastodon' }, userId);

    const post = await createPostInternal(db, tenantId, {
      content_id: content.content_id,
      channel_ids: [chanA.channel_id, chanB.channel_id],
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      created_by: userId,
    });
    const targets = await tenantTable('social_post_targets')
      .where({ tenant: tenantId, post_id: post.post_id })
      .orderBy('channel_id', 'asc');

    // Publish target A straight from 'scheduled' — the rollup makes the post
    // 'published' while B is still scheduled.
    await markTargetPublishedInternal(db, tenantId, targets[0].target_id, {
      permalink: 'https://example.com/early',
      publishedBy: userId,
      publishedVia: 'ui',
    });
    const rolledUp = await tenantTable('social_posts')
      .where({ tenant: tenantId, post_id: post.post_id })
      .first();
    expect(rolledUp.status).toBe('published');

    // The flip job is driven off target state, so B still flips when due.
    const flip = await flipDuePostsInternal(db, tenantId, new Date());
    expect(flip.flipped).toBeGreaterThanOrEqual(1);
    const siblingAfterFlip = await tenantTable('social_post_targets')
      .where({ tenant: tenantId, target_id: targets[1].target_id })
      .first();
    expect(siblingAfterFlip.status).toBe('awaiting-manual-publish');

    // ...and B is independently publishable.
    const publishedB = await markTargetPublishedInternal(db, tenantId, targets[1].target_id, {
      permalink: 'https://example.com/late',
      publishedBy: userId,
      publishedVia: 'ui',
    });
    expect(publishedB.status).toBe('published');
  });

  it('M4: publishing a terminal target is refused without overwriting it or double-recording', async () => {
    const content = await createContentInternal(db, tenantId, {
      title: 'Terminal target',
      body_markdown: 'Expired means expired',
      channel_variants: {},
    }, userId);
    const channel = await createChannelInternal(db, tenantId, { name: 'Chan T', platform: 'linkedin' }, userId);
    const post = await createPostInternal(db, tenantId, {
      content_id: content.content_id,
      channel_ids: [channel.channel_id],
      scheduled_at: new Date(Date.now() - 60_000).toISOString(),
      created_by: userId,
    });
    const [target] = await tenantTable('social_post_targets')
      .where({ tenant: tenantId, post_id: post.post_id });
    await tenantTable('social_post_targets')
      .where({ tenant: tenantId, target_id: target.target_id })
      .update({ status: 'expired' });

    const publishedType = await db('system_interaction_types')
      .where({ type_name: 'Marketing: Post Published' })
      .first('type_id');
    const interactionsBefore = await tenantTable('interactions')
      .where({ tenant: tenantId, type_id: publishedType.type_id });

    await expect(
      markTargetPublishedInternal(db, tenantId, target.target_id, {
        permalink: 'https://example.com/too-late',
        publishedBy: userId,
        publishedVia: 'api',
      }),
    ).rejects.toThrow(/cannot be published/i);

    const after = await tenantTable('social_post_targets')
      .where({ tenant: tenantId, target_id: target.target_id })
      .first();
    expect(after.status).toBe('expired');
    expect(after.permalink).toBeNull();
    const interactionsAfter = await tenantTable('interactions')
      .where({ tenant: tenantId, type_id: publishedType.type_id });
    expect(interactionsAfter).toHaveLength(interactionsBefore.length);
  });
});
