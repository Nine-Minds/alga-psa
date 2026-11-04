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
  tenantDb: (conn: any, tenant: string) => ({
    tenant,
    table: (table: string) => {
      const builder = conn(table);
      // The facade builds joins via .modify(); the mock-knex builders here do
      // not implement it, so provide a pass-through that runs the callback.
      if (builder && typeof builder.modify !== 'function') {
        builder.modify = (fn: (qb: any) => void) => {
          fn(builder);
          return builder;
        };
      }
      return builder;
    },
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any, table: string, _left?: string, _right?: string, opts?: any) =>
      opts?.type === 'left' ? query.leftJoin?.(table) ?? query : query.join?.(table) ?? query,
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: unknown[]) => resolveBundleRulesMock(...args),
}));

// The shared self-approval predicate resolves "who holds the permission" through
// @alga-psa/authorization's own RBAC copy, so point that copy at the same fixture.
vi.mock('@alga-psa/authorization/rbac', () => ({
  hasPermission: (...args: unknown[]) => hasPermissionMock(...args),
}));

vi.mock('@alga-psa/authorization/kernel', () => {
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

  // Mirrors packages/authorization/src/kernel/selfApproval.ts so the mocked kernel
  // exercises the same shared decision the production provider uses.
  const isSelfApprovalBlocked = (input: any) => {
    if (input.mutation?.kind !== 'approve') return false;
    if (input.mutation.allowSelfApproval === true) return false;
    const ownerUserId = input.record?.ownerUserId;
    return typeof ownerUserId === 'string' && ownerUserId === input.subject.userId;
  };

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
    isSelfApprovalBlocked,
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

function buildDb(managedIds: string[], tenantUserIds: string[] = []) {
  return ((table: string) => {
    if (table === 'teams') {
      return {
        join: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        select: vi.fn(async () => managedIds.map((user_id) => ({ user_id }))),
      };
    }

    if (table === 'users') {
      // Tenant approver candidates for the sole-approver check. `.whereNot('user_id', ...)`
      // records the subject so the mock mirrors the real query's exclusion.
      let excludedUserId: string | undefined;
      const builder = {
        where: vi.fn(() => builder),
        andWhere: vi.fn(() => builder),
        whereNot: vi.fn((_column: string, value: string) => {
          excludedUserId = value;
          return builder;
        }),
        select: vi.fn(async () =>
          tenantUserIds
            .filter((user_id) => user_id !== excludedUserId)
            .map((user_id) => ({ user_id, user_type: 'internal' as const }))
        ),
      };
      return builder;
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
      if (resource !== 'time_sheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return false;
      return false;
    });

    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-2', db)).resolves.toBe('manager');

    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource !== 'time_sheet') return false;
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
      if (resource !== 'time_sheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return true;
      return false;
    });

    resolveBundleRulesMock.mockResolvedValueOnce([
      {
        resource: 'time_entry',
        action: 'read',
        templateKey: 'own',
      },
    ]);

    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-2', buildDb(['u-2']))).rejects.toThrow(
      'Permission denied: Cannot access other users time sheets'
    );

    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource !== 'time_sheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return false;
      return false;
    });

    resolveBundleRulesMock.mockResolvedValueOnce([
      {
        resource: 'time_entry',
        action: 'read',
        templateKey: 'own_or_managed',
      },
    ]);

    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-999', buildDb([]))).rejects.toThrow(
      'Permission denied: Cannot access other users time sheets'
    );
  });

  it('T019: self-approval is denied for multiple and sole approvers, including with not-self-approver bundle rules', async () => {
    const actor: TestUser = { user_id: 'u-1', user_type: 'internal' };
    const tenantUsers = ['u-1', 'u-2'];

    const grantTo = (holders: Record<string, string[]>) =>
      hasPermissionMock.mockImplementation(async (user: any, resource: string, action: string) => {
        if (resource !== 'time_sheet') return false;
        return (holders[user?.user_id] ?? []).includes(action);
      });

    // Self-approval is denied when other tenant approvers exist.
    grantTo({
      'u-1': ['approve', 'read_all'],
      'u-2': ['approve', 'read_all'],
    });
    await expect(assertCanApproveSubject(actor as any, 'tenant-1', 'u-1', buildDb([], tenantUsers))).rejects.toThrow(
      'Permission denied: Cannot approve your own time submissions'
    );

    // Being the sole tenant approver does not bypass the time-sheet guard.
    grantTo({ 'u-1': ['approve', 'read_all'] });
    await expect(assertCanApproveSubject(actor as any, 'tenant-1', 'u-1', buildDb([], tenantUsers))).rejects.toThrow(
      'Permission denied: Cannot approve your own time submissions'
    );

    // A configured not-self-approver bundle rule denies even the sole approver.
    resolveBundleRulesMock.mockResolvedValueOnce([
      {
        resource: 'time_entry',
        action: 'approve',
        constraintKey: 'not_self_approver',
      },
    ]);

    await expect(assertCanApproveSubject(actor as any, 'tenant-1', 'u-1', buildDb([], tenantUsers))).rejects.toThrow(
      'Permission denied: Cannot approve your own time submissions'
    );

    // Approving someone else's time is unaffected by the self-approval guard.
    await expect(assertCanApproveSubject(actor as any, 'tenant-1', 'u-2', buildDb(['u-2'], tenantUsers))).resolves.toBe('tenant-wide');
  });

  it('T026: delegation and approval checks fail closed when bundle narrowing resolution errors', async () => {
    const actor: TestUser = { user_id: 'u-1', user_type: 'internal' };

    hasPermissionMock.mockImplementation(async (_user: unknown, resource: string, action: string) => {
      if (resource !== 'time_sheet') return false;
      if (action === 'approve') return true;
      if (action === 'read_all') return true;
      return false;
    });

    resolveBundleRulesMock.mockRejectedValueOnce(new Error('bundle lookup failed'));
    await expect(assertCanActOnBehalf(actor as any, 'tenant-1', 'u-2', buildDb(['u-2']))).rejects.toThrow(
      'Permission denied: Cannot access other users time sheets'
    );

    resolveBundleRulesMock
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('bundle lookup failed'));
    await expect(assertCanApproveSubject(actor as any, 'tenant-1', 'u-2', buildDb(['u-2']))).rejects.toThrow(
      'Permission denied: Cannot approve time submissions'
    );
  });
});
