import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.hoisted(() => vi.fn());
const assertTierAccessMock = vi.hoisted(() => vi.fn(async () => undefined));
const createTenantKnexMock = vi.hoisted(() =>
  vi.fn(async () => ({
    knex: Object.assign(vi.fn(), {
      transaction: vi.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback({})),
    }),
  }))
);
const serviceMocks = vi.hoisted(() => ({
  createAuthorizationBundle: vi.fn(),
  ensureDraftBundleRevision: vi.fn(),
  listBundleRulesForRevision: vi.fn(),
  upsertBundleRule: vi.fn(),
  publishBundleRevision: vi.fn(),
  createBundleAssignment: vi.fn(),
  setBundleAssignmentStatus: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...args: any[]) => unknown) => async (...args: any[]) =>
    handler(
      { user_id: 'actor-1', tenant: 'tenant-1', roles: [{ role_name: 'Admin' }] },
      { tenant: 'tenant-1' },
      ...args
    ),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('server/src/lib/tier-gating/assertTierAccess', () => ({
  assertTierAccess: (...args: unknown[]) => assertTierAccessMock(...args),
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
}));

vi.mock('server/src/lib/authorization/bundles/service', () => ({
  archiveBundle: vi.fn(),
  cloneAuthorizationBundle: vi.fn(),
  createBundleAssignment: (...args: unknown[]) => serviceMocks.createBundleAssignment(...args),
  deleteBundleRule: vi.fn(),
  createAuthorizationBundle: (...args: unknown[]) => serviceMocks.createAuthorizationBundle(...args),
  ensureDraftBundleRevision: (...args: unknown[]) => serviceMocks.ensureDraftBundleRevision(...args),
  listBundleRulesForRevision: (...args: unknown[]) => serviceMocks.listBundleRulesForRevision(...args),
  listAuthorizationBundles: vi.fn(async () => []),
  publishBundleRevision: (...args: unknown[]) => serviceMocks.publishBundleRevision(...args),
  setBundleAssignmentStatus: (...args: unknown[]) => serviceMocks.setBundleAssignmentStatus(...args),
  upsertBundleRule: (...args: unknown[]) => serviceMocks.upsertBundleRule(...args),
}));

import {
  createAuthorizationBundleAction,
  upsertAuthorizationBundleDraftRuleAction,
  publishAuthorizationBundleDraftAction,
  createAuthorizationBundleAssignmentAction,
  setAuthorizationBundleAssignmentStatusAction,
  runAuthorizationBundleSimulationAction,
} from '../../../../../ee/server/src/lib/actions/auth/authorizationBundleActions';

describe('authorization bundle management permission guards', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    assertTierAccessMock.mockReset();
    createTenantKnexMock.mockReset();
    serviceMocks.createAuthorizationBundle.mockReset();
    serviceMocks.ensureDraftBundleRevision.mockReset();
    serviceMocks.listBundleRulesForRevision.mockReset();
    serviceMocks.upsertBundleRule.mockReset();
    serviceMocks.publishBundleRevision.mockReset();
    serviceMocks.createBundleAssignment.mockReset();
    serviceMocks.setBundleAssignmentStatus.mockReset();

    assertTierAccessMock.mockResolvedValue(undefined);
    hasPermissionMock.mockResolvedValue(true);
    createTenantKnexMock.mockResolvedValue({
      knex: Object.assign(vi.fn(), {
        transaction: vi.fn(async (callback: (trx: unknown) => Promise<unknown>) => callback({})),
      }),
    });
    serviceMocks.ensureDraftBundleRevision.mockResolvedValue({ revisionId: 'draft-1' });
    serviceMocks.listBundleRulesForRevision.mockResolvedValue([]);
  });

  it('T026: blocks create/edit/publish/assignment/simulator actions when system_settings permission is missing', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await expect(createAuthorizationBundleAction({ name: 'Bundle A' })).rejects.toThrow(
      'You do not have permission to manage authorization bundles.'
    );
    await expect(
      upsertAuthorizationBundleDraftRuleAction({
        bundleId: 'bundle-1',
        resourceType: 'ticket',
        action: 'read',
        templateKey: 'own',
      })
    ).rejects.toThrow('You do not have permission to manage authorization bundles.');
    await expect(publishAuthorizationBundleDraftAction('bundle-1')).rejects.toThrow(
      'You do not have permission to manage authorization bundles.'
    );
    await expect(
      createAuthorizationBundleAssignmentAction({
        bundleId: 'bundle-1',
        targetType: 'role',
        targetId: 'role-1',
      })
    ).rejects.toThrow('You do not have permission to manage authorization bundles.');
    await expect(
      setAuthorizationBundleAssignmentStatusAction({
        assignmentId: 'assignment-1',
        status: 'disabled',
      })
    ).rejects.toThrow('You do not have permission to manage authorization bundles.');
    await expect(
      runAuthorizationBundleSimulationAction({
        bundleId: 'bundle-1',
        principalUserId: 'user-1',
        resourceType: 'ticket',
        action: 'read',
        syntheticRecord: { ownerUserId: 'user-1' },
      })
    ).rejects.toThrow('You do not have permission to manage authorization bundles.');

    expect(serviceMocks.createAuthorizationBundle).not.toHaveBeenCalled();
    expect(serviceMocks.upsertBundleRule).not.toHaveBeenCalled();
    expect(serviceMocks.publishBundleRevision).not.toHaveBeenCalled();
    expect(serviceMocks.createBundleAssignment).not.toHaveBeenCalled();
    expect(serviceMocks.setBundleAssignmentStatus).not.toHaveBeenCalled();
  });

  it('preserves draft rule position when updating an existing rule', async () => {
    serviceMocks.listBundleRulesForRevision.mockResolvedValue([
      {
        ruleId: 'rule-1',
        resourceType: 'ticket',
        action: 'read',
        templateKey: 'own',
        constraintKey: null,
        config: {},
        position: 7,
      },
    ]);

    await upsertAuthorizationBundleDraftRuleAction({
      bundleId: 'bundle-1',
      ruleId: 'rule-1',
      resourceType: 'ticket',
      action: 'read',
      templateKey: 'own_or_assigned',
    });

    expect(serviceMocks.upsertBundleRule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ruleId: 'rule-1',
        position: 7,
      })
    );
  });
});
