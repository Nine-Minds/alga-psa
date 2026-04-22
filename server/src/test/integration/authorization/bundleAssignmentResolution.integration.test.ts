import { randomUUID } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestContext } from '../../../../test-utils/testContext';
import {
  createAuthorizationBundle,
  createBundleAssignment,
  publishBundleRevision,
  resolveBundleNarrowingRulesForEvaluation,
  upsertBundleRule,
} from 'server/src/lib/authorization/bundles/service';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  createAuthorizationKernel,
} from 'server/src/lib/authorization/kernel';

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('authorization bundle assignment and resolution integration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({
      cleanupTables: [
        'authorization_bundle_assignments',
        'authorization_bundle_rules',
        'authorization_bundle_revisions',
        'authorization_bundles',
        'team_members',
        'teams',
        'user_roles',
        'roles',
        'api_keys',
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

  async function createPublishedBundleWithRule(input: {
    resourceType: string;
    action: string;
    templateKey: string;
    config?: Record<string, unknown>;
  }): Promise<string> {
    const created = await createAuthorizationBundle(ctx.db, {
      tenant: ctx.tenantId,
      name: `Bundle-${randomUUID()}`,
      actorUserId: ctx.user.user_id,
    });

    await upsertBundleRule(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      resourceType: input.resourceType,
      action: input.action,
      templateKey: input.templateKey,
      config: input.config ?? {},
      actorUserId: ctx.user.user_id,
    });

    await publishBundleRevision(ctx.db as any, {
      tenant: ctx.tenantId,
      bundleId: created.bundleId,
      revisionId: created.revisionId,
      actorUserId: ctx.user.user_id,
    });

    return created.bundleId;
  }

  it('rejects assignment creation for wrong or missing target references', async () => {
    const bundleId = await createPublishedBundleWithRule({
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own',
    });

    await expect(
      createBundleAssignment(ctx.db, {
        tenant: ctx.tenantId,
        bundleId,
        targetType: 'role',
        targetId: randomUUID(),
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('role was not found');

    await expect(
      createBundleAssignment(ctx.db, {
        tenant: ctx.tenantId,
        bundleId,
        targetType: 'team',
        targetId: randomUUID(),
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('team was not found');

    await expect(
      createBundleAssignment(ctx.db, {
        tenant: ctx.tenantId,
        bundleId,
        targetType: 'user',
        targetId: randomUUID(),
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('user was not found');

    await expect(
      createBundleAssignment(ctx.db, {
        tenant: ctx.tenantId,
        bundleId,
        targetType: 'api_key',
        targetId: randomUUID(),
        actorUserId: ctx.user.user_id,
      })
    ).rejects.toThrow('api key was not found');
  });

  it('combines role, team, and direct-user assignments as narrowing intersections', async () => {
    const roleId = randomUUID();
    const teamId = randomUUID();
    await ctx.db('roles').insert({
      tenant: ctx.tenantId,
      role_id: roleId,
      role_name: 'Bundle Test Role',
    });
    await ctx.db('user_roles').insert({
      tenant: ctx.tenantId,
      user_id: ctx.user.user_id,
      role_id: roleId,
    });
    await ctx.db('teams').insert({
      tenant: ctx.tenantId,
      team_id: teamId,
      team_name: 'Bundle Test Team',
      manager_id: ctx.user.user_id,
    });
    await ctx.db('team_members').insert({
      tenant: ctx.tenantId,
      team_id: teamId,
      user_id: ctx.user.user_id,
    });

    const roleBundle = await createPublishedBundleWithRule({
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own',
      config: { constraints: [{ field: 'client_id', operator: 'in', value: ['client-a'] }] },
    });
    const teamBundle = await createPublishedBundleWithRule({
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own',
      config: { constraints: [{ field: 'board_id', operator: 'in', value: ['board-a'] }] },
    });
    const userBundle = await createPublishedBundleWithRule({
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own',
      config: { constraints: [{ field: 'priority', operator: 'eq', value: 'high' }] },
    });

    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: roleBundle,
      targetType: 'role',
      targetId: roleId,
      actorUserId: ctx.user.user_id,
    });
    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: teamBundle,
      targetType: 'team',
      targetId: teamId,
      actorUserId: ctx.user.user_id,
    });
    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: userBundle,
      targetType: 'user',
      targetId: ctx.user.user_id,
      actorUserId: ctx.user.user_id,
    });

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async (input) => resolveBundleNarrowingRulesForEvaluation(ctx.db, input),
      }),
      rbacEvaluator: async () => true,
    });

    const scope = await kernel.resolveScope({
      knex: ctx.db as any,
      subject: {
        tenant: ctx.tenantId,
        userId: ctx.user.user_id,
        userType: 'internal',
      },
      resource: {
        type: 'ticket',
        action: 'read',
      },
      record: {
        id: randomUUID(),
        ownerUserId: ctx.user.user_id,
      },
    });

    expect(scope.allowAll).toBe(false);
    expect(scope.denied).toBe(false);
    expect(scope.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'client_id' }),
        expect.objectContaining({ field: 'board_id' }),
        expect.objectContaining({ field: 'priority' }),
      ])
    );
  });

  it('intersects api-key bundle rules with user bundle rules and never broadens scope', async () => {
    const userBundle = await createPublishedBundleWithRule({
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own',
      config: { constraints: [{ field: 'client_id', operator: 'in', value: ['client-u'] }] },
    });
    const apiKeyBundle = await createPublishedBundleWithRule({
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own',
      config: { constraints: [{ field: 'board_id', operator: 'in', value: ['board-k'] }] },
    });

    const apiKeyId = randomUUID();
    await ctx.db('api_keys').insert({
      api_key_id: apiKeyId,
      api_key: `test-key-${randomUUID()}`,
      user_id: ctx.user.user_id,
      tenant: ctx.tenantId,
      active: true,
    });

    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: userBundle,
      targetType: 'user',
      targetId: ctx.user.user_id,
      actorUserId: ctx.user.user_id,
    });
    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId: apiKeyBundle,
      targetType: 'api_key',
      targetId: apiKeyId,
      actorUserId: ctx.user.user_id,
    });

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async (input) => resolveBundleNarrowingRulesForEvaluation(ctx.db, input),
      }),
      rbacEvaluator: async () => true,
    });

    const withoutApiKey = await kernel.resolveScope({
      knex: ctx.db as any,
      subject: {
        tenant: ctx.tenantId,
        userId: ctx.user.user_id,
        userType: 'internal',
      },
      resource: { type: 'ticket', action: 'read' },
      record: { id: randomUUID(), ownerUserId: ctx.user.user_id },
    });

    const withApiKey = await kernel.resolveScope({
      knex: ctx.db as any,
      subject: {
        tenant: ctx.tenantId,
        userId: ctx.user.user_id,
        userType: 'internal',
        apiKeyId,
      },
      resource: { type: 'ticket', action: 'read' },
      record: { id: randomUUID(), ownerUserId: ctx.user.user_id },
    });

    expect(withoutApiKey.constraints).toHaveLength(1);
    expect(withApiKey.constraints).toHaveLength(2);
    expect(withApiKey.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'client_id' }),
        expect.objectContaining({ field: 'board_id' }),
      ])
    );
  });

  it('role assignment to a published bundle immediately narrows ticket read decisions', async () => {
    const roleId = randomUUID();
    await ctx.db('roles').insert({
      tenant: ctx.tenantId,
      role_id: roleId,
      role_name: 'Ticket Restricted Role',
    });
    await ctx.db('user_roles').insert({
      tenant: ctx.tenantId,
      user_id: ctx.user.user_id,
      role_id: roleId,
    });

    const bundleId = await createPublishedBundleWithRule({
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own',
    });

    await createBundleAssignment(ctx.db, {
      tenant: ctx.tenantId,
      bundleId,
      targetType: 'role',
      targetId: roleId,
      actorUserId: ctx.user.user_id,
    });

    const kernel = createAuthorizationKernel({
      builtinProvider: new BuiltinAuthorizationKernelProvider(),
      bundleProvider: new BundleAuthorizationKernelProvider({
        resolveRules: async (input) => resolveBundleNarrowingRulesForEvaluation(ctx.db, input),
      }),
      rbacEvaluator: async () => true,
    });

    const allowed = await kernel.authorizeResource({
      knex: ctx.db as any,
      subject: {
        tenant: ctx.tenantId,
        userId: ctx.user.user_id,
        userType: 'internal',
      },
      resource: { type: 'ticket', action: 'read' },
      record: { id: randomUUID(), ownerUserId: ctx.user.user_id },
    });

    const denied = await kernel.authorizeResource({
      knex: ctx.db as any,
      subject: {
        tenant: ctx.tenantId,
        userId: ctx.user.user_id,
        userType: 'internal',
      },
      resource: { type: 'ticket', action: 'read' },
      record: { id: randomUUID(), ownerUserId: randomUUID() },
    });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
    expect(denied.reasons.some((reason) => reason.code === 'bundle_template_denied')).toBe(true);
  });
});
