/**
 * T013 — marketing publish queue in the unified activities feed (DB half).
 *
 * A social post target in awaiting-manual-publish shows up in
 * collectProcessedActivities (via fetchUserActivitiesForApi) as a SCHEDULE
 * activity titled 'Publish to {channel name}', due at the post's
 * scheduled_at, linking to /msp/marketing/calendar, escalated to HIGH
 * priority when overdue. It disappears after markTargetPublishedInternal, and
 * never appears while the marketing-module flag is off for the tenant.
 *
 * Harness notes:
 *  - The feature flag is controlled by registering a checker with
 *    @alga-psa/core's registerFeatureFlagChecker (the production registration
 *    in initializeApp never runs under tests, so the default is "off").
 *  - fetchMarketingActivities resolves its knex via createTenantKnex from
 *    @alga-psa/db, so that one export is mocked to the test connection (same
 *    technique as test/integration/api/userActivities.test.ts).
 *  - @alga-psa/auth is globally mocked by src/test/setup.ts
 *    (hasPermission -> true), so the marketing:manage gate passes; the
 *    permission-denied branch is covered by the executable unit half in
 *    packages/user-activities/src/actions/marketingActivities.test.ts.
 *
 * Requires the standard test DB; skipped automatically when no database is
 * reachable unless REQUIRE_DB=1.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
  markTargetPublishedInternal,
} from '../../../../packages/marketing/src/lib/posts';

const describeDb = await describeWithDb();
const requireCjs = createRequire(import.meta.url);

// Lazily-resolved handle to the test connection, read by the @alga-psa/db
// mock below once beforeAll has created it.
const dbRef = vi.hoisted(() => ({ db: null as unknown as Knex, tenant: '' }));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: dbRef.db, tenant: dbRef.tenant })),
  };
});

import { registerFeatureFlagChecker } from '@alga-psa/core';
import { ActivityPriority, ActivityType } from '@alga-psa/types';
import { fetchUserActivitiesForApi } from '@alga-psa/user-activities/server/activity-actions';

let db: Knex;
let tenantId: string;
let userId: string;

function tenantTable(table: string) {
  return tenantDb(db, tenantId).table(table);
}

async function marketingPostActivities() {
  const response = await fetchUserActivitiesForApi(
    { user_id: userId, tenant: tenantId, user_type: 'internal' },
    tenantId,
    { types: [ActivityType.SCHEDULE] },
    1,
    50,
  );
  return response.activities.filter((activity: any) => activity.workItemType === 'marketing_post');
}

describeDb('T013: awaiting-publish targets in the activities feed', () => {
  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: false });
    tenantId = await createTenant(db, 'Marketing Activities Tenant');
    userId = await createUser(db, tenantId, { username: 'marketing.activities.test' });
    dbRef.db = db;
    dbRef.tenant = tenantId;

    const seedTypes = requireCjs('../../../migrations/20260719103000_seed_marketing_interaction_types.cjs');
    await seedTypes.up(db);
  }, 120_000);

  afterAll(async () => {
    registerFeatureFlagChecker(async () => false);
    await db?.destroy();
  });

  it('surfaces awaiting-publish targets as SCHEDULE activities only while the flag is on, and removes them once published', async () => {
    const content = await createContentInternal(db, tenantId, {
      title: 'Launch announcement',
      body_markdown: 'We shipped a thing',
      channel_variants: {},
    }, userId);
    const linkedin = await createChannelInternal(db, tenantId, { name: 'LinkedIn', platform: 'linkedin' }, userId);

    const scheduledAt = new Date(Date.now() - 60 * 60_000).toISOString(); // one hour ago: due + overdue
    const post = await createPostInternal(db, tenantId, {
      content_id: content.content_id,
      channel_ids: [linkedin.channel_id],
      scheduled_at: scheduledAt,
      created_by: userId,
    });
    await flipDuePostsInternal(db, tenantId, new Date());

    const [target] = await tenantTable('social_post_targets')
      .where({ tenant: tenantId, post_id: post.post_id });
    expect(target.status).toBe('awaiting-manual-publish');

    // Flag off: nothing marketing-related reaches the feed.
    registerFeatureFlagChecker(async (flag) => flag !== 'marketing-module');
    expect(await marketingPostActivities()).toHaveLength(0);

    // Flag on: the target is a SCHEDULE activity titled 'Publish to LinkedIn',
    // due at scheduled_at, overdue -> HIGH, deep-linking the marketing calendar.
    registerFeatureFlagChecker(async () => true);
    const withFlagOn = await marketingPostActivities();
    expect(withFlagOn).toHaveLength(1);
    expect(withFlagOn[0]).toMatchObject({
      id: target.target_id,
      title: 'Publish to LinkedIn',
      description: 'Launch announcement',
      type: ActivityType.SCHEDULE,
      status: 'overdue',
      priority: ActivityPriority.HIGH,
      dueDate: new Date(scheduledAt).toISOString(),
      link: '/msp/marketing/posts',
      workItemType: 'marketing_post',
      tenant: tenantId,
    });

    // After the target is marked published it leaves the queue — and the feed.
    await markTargetPublishedInternal(db, tenantId, target.target_id, {
      permalink: 'https://linkedin.com/posts/launch-1',
      publishedBy: userId,
      publishedVia: 'ui',
    });
    expect(await marketingPostActivities()).toHaveLength(0);
  });
});
