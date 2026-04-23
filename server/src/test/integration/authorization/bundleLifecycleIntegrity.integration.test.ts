import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import {
  archiveBundle,
  cloneAuthorizationBundle,
  createAuthorizationBundle,
  createBundleAssignment,
  ensureDraftBundleRevision,
  publishBundleRevision,
  setBundleAssignmentStatus,
  upsertBundleRule,
} from '@alga-psa/authorization/bundles/service';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('authorization bundle lifecycle integrity integration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'authorization_bundle_assignments',
        'authorization_bundle_rules',
        'authorization_bundle_revisions',
        'authorization_bundles',
        'user_roles',
        'roles',
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

  async function createPublishedBundleWithRule(): Promise<{ bundleId: string; revisionId: string }> {
    const created = await createAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      name: `Bundle-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });

    await upsertBundleRule(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own_or_assigned',
      actorUserId: ctx.user.user_id,
      position: 0,
    });

    await publishBundleRevision(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      actorUserId: ctx.user.user_id,
    });

    return created;
  }

  it('serializes concurrent draft creation and leaves exactly one initialized draft', async () => {
    const created = await createPublishedBundleWithRule();

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureDraftBundleRevision(ctx.db, {
          tenant: ctx.tenantId,
          bundleId: created.bundleId,
          actorUserId: ctx.user.user_id,
        })
      )
    );

    const draftIds = [...new Set(attempts.map((attempt) => attempt.revisionId))];
    expect(draftIds).toHaveLength(1);
    expect(attempts.some((attempt) => attempt.created)).toBe(true);

    const draftRows = await ctx.db('authorization_bundle_revisions')
      .where({
        tenant: ctx.tenantId,
        bundle_id: created.bundleId,
        lifecycle_state: 'draft',
      })
      .select<{ revision_id: string }[]>('revision_id');
    expect(draftRows).toHaveLength(1);
    expect(draftRows[0].revision_id).toBe(draftIds[0]);

    const copiedRules = await ctx.db('authorization_bundle_rules')
      .where({ tenant: ctx.tenantId, revision_id: draftIds[0] })
      .select<{ resource_type: string; action: string; template_key: string }[]>(
        'resource_type',
        'action',
        'template_key'
      );
    expect(copiedRules).toEqual([
      {
        resource_type: 'ticket',
        action: 'read',
        template_key: 'own_or_assigned',
      },
    ]);
  });

  it('rolls back draft creation when published-rule copy fails', async () => {
    const created = await createAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      name: `Atomicity-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });

    await ctx.db('authorization_bundle_rules').insert([
      {
        tenant: ctx.tenantId,
        bundle_id: created.bundleId,
        revision_id: created.revisionId,
        resource_type: 'ticket',
        action: 'read',
        template_key: 'own_or_assigned',
        effect: 'narrow',
        config: {},
        position: 0,
        created_by: ctx.user.user_id,
      },
      {
        tenant: ctx.tenantId,
        bundle_id: created.bundleId,
        revision_id: created.revisionId,
        resource_type: 'ticket',
        action: 'read',
        template_key: 'own_or_assigned',
        effect: 'narrow',
        config: {},
        position: 0,
        created_by: ctx.user.user_id,
      },
    ]);

    await publishBundleRevision(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      actorUserId: ctx.user.user_id,
    });

    const tempIndexName = `ab_rule_copy_guard_${randomUUID().replace(/-/g, '')}`;
    await ctx.db.raw(`
      CREATE UNIQUE INDEX ${tempIndexName}
      ON authorization_bundle_rules (tenant, revision_id, resource_type, action, template_key, position)
      WHERE revision_id <> '${created.revisionId}'
    `);

    try {
      await expect(
        ensureDraftBundleRevision(ctx.db, {
          tenant: ctx.tenantId,
          bundleId: created.bundleId,
          actorUserId: ctx.user.user_id,
        })
      ).rejects.toThrow();

      const remainingDrafts = await ctx.db('authorization_bundle_revisions')
        .where({
          tenant: ctx.tenantId,
          bundle_id: created.bundleId,
          lifecycle_state: 'draft',
        })
        .count<{ count: string }>('revision_id as count')
        .first();
      expect(Number(remainingDrafts?.count || 0)).toBe(0);
    } finally {
      await ctx.db.raw(`DROP INDEX IF EXISTS ${tempIndexName}`);
    }
  });

  it('rejects stale draft mutation attempts after publish wins the race', async () => {
    const created = await createPublishedBundleWithRule();

    const draft = await ensureDraftBundleRevision(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      actorUserId: ctx.user.user_id,
    });

    await publishBundleRevision(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: draft.revisionId,
      actorUserId: ctx.user.user_id,
    });

    await expect(
      upsertBundleRule(ctx.db, {
        tenant: ctx.tenantId,
        bundleId: created.bundleId,
        revisionId: draft.revisionId,
        resourceType: 'ticket',
        action: 'read',
        templateKey: 'selected_clients',
        config: { selectedClientIds: [ctx.clientId] },
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('Draft revision not found for bundle in tenant scope.');
  });

  it('rejects publishing empty drafts and enforces assignment/archive governance', async () => {
    const created = await createAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      name: `DraftOnly-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });

    await expect(
      publishBundleRevision(ctx.db, {
        tenant: ctx.tenantId,
        bundleId: created.bundleId,
        revisionId: created.revisionId,
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('Cannot publish an empty draft revision. Add at least one narrowing rule before publishing.');

    const roleId = randomUUID();
    await ctx.db('roles').insert({
      tenant: ctx.tenantId,
      role_id: roleId,
      role_name: 'Lifecycle Integrity Role',
    });

    await upsertBundleRule(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own_or_assigned',
      actorUserId: ctx.user.user_id,
      position: 0,
    });

    await publishBundleRevision(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      actorUserId: ctx.user.user_id,
    });

    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      targetType: 'role',
      targetId: roleId,
      actorUserId: ctx.user.user_id,
    });

    const assignment = await ctx.db('authorization_bundle_assignments')
      .where({ tenant: ctx.tenantId, bundle_id: created.bundleId, target_type: 'role', target_id: roleId })
      .first<{ assignment_id: string; status: 'active' | 'disabled' }>('assignment_id', 'status');
    expect(assignment?.status).toBe('active');

    await archiveBundle(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      actorUserId: ctx.user.user_id,
    });

    const archivedAssignment = await ctx.db('authorization_bundle_assignments')
      .where({ tenant: ctx.tenantId, assignment_id: assignment?.assignment_id })
      .first<{ status: 'active' | 'disabled' }>('status');
    expect(archivedAssignment?.status).toBe('disabled');

    await expect(
      createBundleAssignment(ctx.db, {
        tenant: ctx.tenantId,
        bundleId: created.bundleId,
        targetType: 'role',
        targetId: roleId,
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('Cannot create an active assignment for an archived bundle.');

    await expect(
      setBundleAssignmentStatus(ctx.db, {
        tenant: ctx.tenantId,
        assignmentId: assignment!.assignment_id,
        status: 'active',
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('Cannot activate an assignment for an archived bundle.');

    await expect(
      ensureDraftBundleRevision(ctx.db, {
        tenant: ctx.tenantId,
        bundleId: created.bundleId,
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('Cannot create or retrieve drafts for an archived bundle.');

    await expect(
      publishBundleRevision(ctx.db, {
        tenant: ctx.tenantId,
        bundleId: created.bundleId,
        revisionId: created.revisionId,
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('Cannot publish revisions for an archived bundle.');

    await expect(
      setBundleAssignmentStatus(ctx.db, {
        tenant: ctx.tenantId,
        assignmentId: randomUUID(),
        status: 'disabled',
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('Bundle assignment not found in tenant scope.');
  });

  it('rejects cloning bundles that do not have a published revision', async () => {
    const draftOnly = await createAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      name: `DraftSource-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });

    await expect(
      cloneAuthorizationBundle(ctx.db, {
        tenant: ctx.tenantId,
        sourceBundleId: draftOnly.bundleId,
        name: `Clone-${randomUUID()}`,
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('Cannot clone a bundle with no published revision. Publish the bundle first.');

    await upsertBundleRule(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: draftOnly.bundleId,
      revisionId: draftOnly.revisionId,
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own_or_assigned',
      actorUserId: ctx.user.user_id,
      position: 0,
    });

    await publishBundleRevision(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: draftOnly.bundleId,
      revisionId: draftOnly.revisionId,
      actorUserId: ctx.user.user_id,
    });

    const clone = await cloneAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      sourceBundleId: draftOnly.bundleId,
      name: `Clone-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });

    const cloneRules = await ctx.db('authorization_bundle_rules')
      .where({ tenant: ctx.tenantId, revision_id: clone.revisionId })
      .count<{ count: string }>('rule_id as count')
      .first();
    expect(Number(cloneRules?.count || 0)).toBe(1);
  });
});
