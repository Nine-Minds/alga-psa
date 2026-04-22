import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionMock = vi.hoisted(() => vi.fn());
const featureFlagMock = vi.hoisted(() => vi.fn());
const reportsToMock = vi.hoisted(() => vi.fn());
const resolveBundleRulesMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/core', () => ({
  isFeatureFlagEnabled: (...args: unknown[]) => featureFlagMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  User: {
    getReportsToSubordinateIds: (...args: unknown[]) => reportsToMock(...args),
  },
}));

vi.mock('server/src/lib/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: unknown[]) => resolveBundleRulesMock(...args),
}));

vi.mock('server/src/lib/authorization/kernel', () => {
  class BuiltinAuthorizationKernelProvider {
    relationshipRules?: Array<{ template: string }>;
    mutationGuards?: Array<(input: any) => { allowed: boolean }>;

    constructor(config?: { relationshipRules?: Array<{ template: string }>; mutationGuards?: Array<(input: any) => { allowed: boolean }> }) {
      this.relationshipRules = config?.relationshipRules;
      this.mutationGuards = config?.mutationGuards;
    }
  }

  class BundleAuthorizationKernelProvider {
    resolveRules: (input: unknown) => Promise<Array<Record<string, unknown>>>;

    constructor(config: { resolveRules: (input: unknown) => Promise<Array<Record<string, unknown>>> }) {
      this.resolveRules = config.resolveRules;
    }
  }

  class RequestLocalAuthorizationCache {}

  const createAuthorizationKernel = (config: {
    builtinProvider?: BuiltinAuthorizationKernelProvider;
    bundleProvider?: BundleAuthorizationKernelProvider;
  }) => ({
    authorizeResource: async (input: any) => {
      const rules = config.bundleProvider ? await config.bundleProvider.resolveRules(input) : [];
      const managedOnly = config.builtinProvider?.relationshipRules?.some((rule) => rule.template === 'managed');
      const builtinAllowed = managedOnly
        ? Array.isArray(input.subject.managedUserIds) && input.subject.managedUserIds.includes(input.record.ownerUserId)
        : true;

      let bundleAllowed = true;
      const matchingRules = rules.filter(
        (rule) => rule.resource === input.resource.type && rule.action === input.resource.action
      );
      for (const rule of matchingRules) {
        if (rule.templateKey === 'own') {
          bundleAllowed = bundleAllowed && input.record.ownerUserId === input.subject.userId;
        }
        if (rule.templateKey === 'managed') {
          bundleAllowed =
            bundleAllowed &&
            Array.isArray(input.subject.managedUserIds) &&
            input.subject.managedUserIds.includes(input.record.ownerUserId);
        }
        if (rule.templateKey === 'own_or_managed') {
          const isOwn = input.record.ownerUserId === input.subject.userId;
          const isManaged =
            Array.isArray(input.subject.managedUserIds) &&
            input.subject.managedUserIds.includes(input.record.ownerUserId);
          bundleAllowed = bundleAllowed && (isOwn || isManaged);
        }
      }

      return {
        allowed: builtinAllowed && bundleAllowed,
        reasons: [],
        scope: { allowAll: builtinAllowed && bundleAllowed, denied: !(builtinAllowed && bundleAllowed), constraints: [] },
        redactedFields: [],
      };
    },
    authorizeMutation: async (input: any) => {
      let builtinAllowed = true;
      for (const guard of config.builtinProvider?.mutationGuards ?? []) {
        const result = guard(input);
        if (!result.allowed) {
          builtinAllowed = false;
          break;
        }
      }

      const rules = config.bundleProvider ? await config.bundleProvider.resolveRules(input) : [];
      const matchingRules = rules.filter(
        (rule) => rule.resource === input.resource.type && rule.action === input.resource.action
      );
      let bundleAllowed = true;
      for (const rule of matchingRules) {
        if (
          rule.constraintKey === 'not_self_approver' &&
          input.record.ownerUserId === input.subject.userId
        ) {
          bundleAllowed = false;
        }
      }

      return {
        allowed: builtinAllowed && bundleAllowed,
        reasons: [],
        scope: { allowAll: builtinAllowed && bundleAllowed, denied: !(builtinAllowed && bundleAllowed), constraints: [] },
        redactedFields: [],
      };
    },
  });

  return {
    BuiltinAuthorizationKernelProvider,
    BundleAuthorizationKernelProvider,
    RequestLocalAuthorizationCache,
    createAuthorizationKernel,
  };
});

import {
  assertCanActOnBehalf,
  assertCanApproveSubject,
  resolveManagedSubjectUserIds,
} from '../src/actions/timeEntryDelegationAuth';

type TestUser = {
  user_id: string;
  user_type: 'internal' | 'client';
  clientId?: string | null;
};

function buildDb(managedIds: string[]) {
  return ((table: string) => {
    if (table === 'teams') {
      return {
        join: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        select: vi.fn(async () => managedIds.map((user_id) => ({ user_id }))),
      };
    }

    if (table === 'users') {
      return {
        where: vi.fn().mockReturnThis(),
        select: vi.fn(async () => []),
      };
    }

    return {
      where: vi.fn().mockReturnThis(),
      select: vi.fn(async () => []),
      first: vi.fn(async () => undefined),
    };
  }) as any;
}

describe('time authorization delegation and approval contracts', () => {
  beforeEach(() => {
    hasPermissionMock.mockReset();
    featureFlagMock.mockReset();
    reportsToMock.mockReset();
    resolveBundleRulesMock.mockReset();

    featureFlagMock.mockResolvedValue(false);
    reportsToMock.mockResolvedValue([]);
    resolveBundleRulesMock.mockResolvedValue([]);
  });

  it('T017: preserves self, manager, reports-to, and tenant-wide delegation semantics', async () => {
    const actor: TestUser = { user_id: 'u-1', user_type: 'internal' };
    const db = buildDb(['u-2']);

    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-1', db)).resolves.toBe('self');

    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource !== 'timesheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return false;
      return false;
    });

    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-2', db)).resolves.toBe('manager');

    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource !== 'timesheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return true;
      return false;
    });

    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-9', db)).resolves.toBe('tenant-wide');

    featureFlagMock.mockResolvedValue(true);
    reportsToMock.mockResolvedValue(['u-77']);
    const managedIds = await resolveManagedSubjectUserIds(db, 'tenant-1', actor as any);
    expect(managedIds).toEqual(expect.arrayContaining(['u-2', 'u-77']));
  });

  it('T018: premium bundle rules can narrow delegation but cannot broaden beyond builtin model', async () => {
    const actor: TestUser = { user_id: 'u-1', user_type: 'internal' };

    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource !== 'timesheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return true;
      return false;
    });

    resolveBundleRulesMock.mockResolvedValueOnce([
      {
        resource: 'timesheet',
        action: 'read',
        templateKey: 'own',
      },
    ]);

    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-2', buildDb(['u-2']))).rejects.toThrow(
      'Permission denied: Cannot access other users time sheets'
    );

    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource !== 'timesheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return false;
      return false;
    });

    resolveBundleRulesMock.mockResolvedValueOnce([
      {
        resource: 'timesheet',
        action: 'read',
        templateKey: 'own_or_managed',
      },
    ]);

    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-999', buildDb([]))).rejects.toThrow(
      'Permission denied: Cannot access other users time sheets'
    );
  });

  it('T019: not-self-approver mutation guard remains enforced on kernelized approval flow', async () => {
    const actor: TestUser = { user_id: 'u-1', user_type: 'internal' };

    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource !== 'timesheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return true;
      return false;
    });

    await expect(assertCanApproveSubject(actor as any, 'tenant-1', 'u-1', buildDb([]))).rejects.toThrow(
      'Permission denied: Cannot approve your own time submissions'
    );

    await expect(assertCanApproveSubject(actor as any, 'tenant-1', 'u-2', buildDb(['u-2']))).resolves.toBe('manager');
  });
});
