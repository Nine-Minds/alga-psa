import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  upsertBundleRule,
} from 'server/src/lib/authorization/bundles/service';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('authorization bundle revision publish integration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'authorization_bundle_assignments',
        'authorization_bundle_rules',
        'authorization_bundle_revisions',
        'authorization_bundles',
      ],
    });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  it('publishes only the target revision and preserves assignments on the stable bundle identity', async () => {
    const tenant = ctx.tenantId;
    const actorUserId = ctx.user.user_id;
    const targetUserId = ctx.user.user_id;

    const created = await createAuthorizationBundle(ctx.db, {
      tenant,
      name: 'Field Technician',
      description: 'Initial bundle',
      actorUserId,
    });

    await upsertBundleRule(ctx.db, {
      tenant,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own_or_assigned',
      position: 0,
      actorUserId,
    });

    await publishBundleRevision(ctx.db as any, {
      tenant,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      actorUserId,
    });

    const [nextRevision] = await ctx.db('authorization_bundle_revisions')
      .insert({
        tenant,
        bundle_id: created.bundleId,
        revision_number: 2,
        lifecycle_state: 'draft',
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .returning<{ revision_id: string }[]>('revision_id');

    await upsertBundleRule(ctx.db, {
      tenant,
      bundleId: created.bundleId,
      revisionId: nextRevision.revision_id,
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'selected_clients',
      config: { selectedClientIds: [ctx.clientId] },
      position: 0,
      actorUserId,
    });

    await createBundleAssignment(ctx.db, {
      tenant,
      bundleId: created.bundleId,
      targetType: 'user',
      targetId: targetUserId,
      actorUserId,
    });

    const assignmentBeforePublish = await ctx.db('authorization_bundle_assignments')
      .where({ tenant, bundle_id: created.bundleId, target_type: 'user', target_id: targetUserId })
      .first<{ assignment_id: string }>('assignment_id');

    await publishBundleRevision(ctx.db as any, {
      tenant,
      bundleId: created.bundleId,
      revisionId: nextRevision.revision_id,
      actorUserId,
    });

    const bundle = await ctx.db('authorization_bundles')
      .where({ tenant, bundle_id: created.bundleId })
      .first<{ published_revision_id: string | null }>('published_revision_id');
    expect(bundle?.published_revision_id).toBe(nextRevision.revision_id);

    const revisions = await ctx.db('authorization_bundle_revisions')
      .where({ tenant, bundle_id: created.bundleId })
      .select<{ revision_id: string; lifecycle_state: string }[]>('revision_id', 'lifecycle_state');

    const revisionStateById = new Map(
      revisions.map((revision) => [revision.revision_id, revision.lifecycle_state])
    );

    expect(revisionStateById.get(created.revisionId)).toBe('archived');
    expect(revisionStateById.get(nextRevision.revision_id)).toBe('published');

    const assignmentAfterPublish = await ctx.db('authorization_bundle_assignments')
      .where({ tenant, bundle_id: created.bundleId, target_type: 'user', target_id: targetUserId })
      .first<{ assignment_id: string; bundle_id: string }>('assignment_id', 'bundle_id');

    expect(assignmentAfterPublish?.assignment_id).toBe(assignmentBeforePublish?.assignment_id);
    expect(assignmentAfterPublish?.bundle_id).toBe(created.bundleId);
  });
});
