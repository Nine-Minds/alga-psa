import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createAuthorizationBundle,
  cloneAuthorizationBundle,
  createBundleAssignment,
  ensureDraftBundleRevision,
  loadAuthorizationEvaluationSnapshot,
  publishBundleRevision,
  resolveBundleNarrowingRulesForEvaluation,
  setBundleRevisionBaseline,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

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

  it('rejects publishing a revision that is no longer draft', async () => {
    const tenant = ctx.tenantId;
    const actorUserId = ctx.user.user_id;

    const created = await createAuthorizationBundle(ctx.db, {
      tenant,
      name: 'Dispatchers',
      description: 'Bundle for publish state checks',
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

    await expect(
      publishBundleRevision(ctx.db as any, {
        tenant,
        bundleId: created.bundleId,
        revisionId: created.revisionId,
        actorUserId,
      })
    ).rejects.toThrow('Only draft revisions can be published. Refresh bundle state and try again.');
  });

  describe('closed baseline (S6)', () => {
    async function bundleWithRule(name: string, baseline?: 'open' | 'closed') {
      const tenant = ctx.tenantId;
      const actorUserId = ctx.user.user_id;
      const created = await createAuthorizationBundle(ctx.db, { tenant, name, actorUserId });
      await upsertBundleRule(ctx.db, {
        tenant, bundleId: created.bundleId, revisionId: created.revisionId,
        resourceType: 'ticket', action: 'read', templateKey: 'own_or_assigned', position: 0, actorUserId,
      });
      await publishBundleRevision(ctx.db as any, {
        tenant, bundleId: created.bundleId, revisionId: created.revisionId, actorUserId,
        ...(baseline ? { baseline } : {}),
      });
      await createBundleAssignment(ctx.db, {
        tenant, bundleId: created.bundleId, targetType: 'user', targetId: ctx.user.user_id, actorUserId,
      });
      return created;
    }

    const evalInput = () => ({
      subject: { tenant: ctx.tenantId, userId: ctx.user.user_id, userType: 'internal' as const, roleIds: [], teamIds: [], managedUserIds: [] },
      resource: { type: 'ticket', action: 'read' },
    });

    it('defaults every revision to open, and reads it back through both loaders', async () => {
      const created = await bundleWithRule('Default baseline');
      const row = await ctx.db('authorization_bundle_revisions').where({ revision_id: created.revisionId }).first('baseline');
      expect(row.baseline).toBe('open');

      const rules = await resolveBundleNarrowingRulesForEvaluation(ctx.db, evalInput() as any);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({ bundleId: created.bundleId, revisionId: created.revisionId, baseline: 'open' });

      const snapshot = await loadAuthorizationEvaluationSnapshot(ctx.db, evalInput().subject);
      expect(snapshot.rules).toHaveLength(1);
      expect(snapshot.rules[0]).toMatchObject({ bundle_id: created.bundleId, revision_id: created.revisionId, baseline: 'open' });
    });

    it('publishes a closed revision and the baseline reaches both loaders', async () => {
      const created = await bundleWithRule('Closed bundle', 'closed');
      const row = await ctx.db('authorization_bundle_revisions').where({ revision_id: created.revisionId }).first('baseline');
      expect(row.baseline).toBe('closed');

      const rules = await resolveBundleNarrowingRulesForEvaluation(ctx.db, evalInput() as any);
      expect(rules[0]).toMatchObject({ bundleId: created.bundleId, revisionId: created.revisionId, baseline: 'closed' });
      const snapshot = await loadAuthorizationEvaluationSnapshot(ctx.db, evalInput().subject);
      expect(snapshot.rules[0]).toMatchObject({ bundle_id: created.bundleId, revision_id: created.revisionId, baseline: 'closed' });
    });

    it('sets a baseline on a draft only, and carries it into a derived draft and a clone', async () => {
      const tenant = ctx.tenantId;
      const actorUserId = ctx.user.user_id;
      const created = await createAuthorizationBundle(ctx.db, { tenant, name: 'Draft baseline', actorUserId });
      await upsertBundleRule(ctx.db, {
        tenant, bundleId: created.bundleId, revisionId: created.revisionId,
        resourceType: 'ticket', action: 'read', templateKey: 'own', position: 0, actorUserId,
      });
      await setBundleRevisionBaseline(ctx.db, { tenant, bundleId: created.bundleId, revisionId: created.revisionId, baseline: 'closed', actorUserId });
      await publishBundleRevision(ctx.db as any, { tenant, bundleId: created.bundleId, revisionId: created.revisionId, actorUserId });
      const published = await ctx.db('authorization_bundle_revisions').where({ revision_id: created.revisionId }).first('baseline');
      expect(published.baseline).toBe('closed');

      await expect(
        setBundleRevisionBaseline(ctx.db, { tenant, bundleId: created.bundleId, revisionId: created.revisionId, baseline: 'open' })
      ).rejects.toThrow('Only a draft revision');

      const draft = await ensureDraftBundleRevision(ctx.db, { tenant, bundleId: created.bundleId, actorUserId });
      const draftRow = await ctx.db('authorization_bundle_revisions').where({ revision_id: draft.revisionId }).first('baseline');
      expect(draftRow.baseline).toBe('closed');

      const clone = await cloneAuthorizationBundle(ctx.db, { tenant, sourceBundleId: created.bundleId, name: 'Draft baseline copy', actorUserId });
      const cloneRow = await ctx.db('authorization_bundle_revisions').where({ revision_id: clone.revisionId }).first('baseline');
      expect(cloneRow.baseline).toBe('closed');
    });

    it('rejects a baseline outside open/closed at the database', async () => {
      const created = await createAuthorizationBundle(ctx.db, { tenant: ctx.tenantId, name: 'Bad baseline', actorUserId: ctx.user.user_id });
      await expect(
        ctx.db('authorization_bundle_revisions').where({ revision_id: created.revisionId }).update({ baseline: 'sideways' })
      ).rejects.toThrow(/authorization_bundle_revisions_baseline_check/);
    });

    it('invariant: a closed revision cannot be published empty', async () => {
      const created = await createAuthorizationBundle(ctx.db, { tenant: ctx.tenantId, name: 'Empty closed', actorUserId: ctx.user.user_id });
      await expect(
        publishBundleRevision(ctx.db as any, {
          tenant: ctx.tenantId, bundleId: created.bundleId, revisionId: created.revisionId, baseline: 'closed',
        })
      ).rejects.toThrow('Cannot publish an empty draft revision');
    });
  });
});
