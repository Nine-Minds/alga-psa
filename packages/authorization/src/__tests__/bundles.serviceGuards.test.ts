import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';

import {
  createAuthorizationBundle,
  cloneAuthorizationBundle,
  resolveBundleNarrowingRulesForEvaluation,
  upsertBundleRule,
} from '../bundles/service';
import type { AuthorizationEvaluationInput } from '../kernel';

/**
 * These tests target the validation / fail-closed guards in the bundle
 * service that must run BEFORE any database work. The knex handle is
 * poisoned: any attempt to build a query or open a transaction throws a
 * sentinel error, so a test failure with the sentinel message means the
 * guard under test did not fire first.
 */

const DB_SENTINEL = 'unexpected database access';

function poisonedKnex(): Knex {
  const poisoned: Record<string, unknown> = {
    transaction: () => {
      throw new Error(DB_SENTINEL);
    },
  };

  return new Proxy(() => undefined, {
    apply() {
      throw new Error(DB_SENTINEL);
    },
    get(_target, prop) {
      if (prop === 'then') return undefined;
      if (prop in poisoned) return poisoned[prop as string];
      throw new Error(`${DB_SENTINEL} (knex.${String(prop)})`);
    },
  }) as unknown as Knex;
}

function evaluationInput(overrides: Partial<AuthorizationEvaluationInput['subject']>): AuthorizationEvaluationInput {
  return {
    subject: {
      tenant: 'tenant-a',
      userId: 'user-1',
      userType: 'internal',
      ...overrides,
    },
    resource: { type: 'ticket', action: 'read' },
  };
}

describe('createAuthorizationBundle input guards', () => {
  it('rejects a missing tenant before touching the database', async () => {
    await expect(
      createAuthorizationBundle(poisonedKnex(), {
        tenant: '',
        name: 'My bundle',
      })
    ).rejects.toThrow('tenant is required');
  });

  it('rejects an empty bundle name before touching the database', async () => {
    await expect(
      createAuthorizationBundle(poisonedKnex(), {
        tenant: 'tenant-a',
        name: '   ',
      })
    ).rejects.toThrow('Bundle name is required.');
  });
});

describe('cloneAuthorizationBundle input guards', () => {
  it('rejects a missing tenant before touching the database', async () => {
    await expect(
      cloneAuthorizationBundle(poisonedKnex(), {
        tenant: '',
        sourceBundleId: 'bundle-1',
        name: 'Clone',
      })
    ).rejects.toThrow('tenant is required');
  });

  it('rejects a missing source bundle id before touching the database', async () => {
    await expect(
      cloneAuthorizationBundle(poisonedKnex(), {
        tenant: 'tenant-a',
        sourceBundleId: '',
        name: 'Clone',
      })
    ).rejects.toThrow('sourceBundleId is required');
  });

  it('rejects an empty clone name before touching the database', async () => {
    await expect(
      cloneAuthorizationBundle(poisonedKnex(), {
        tenant: 'tenant-a',
        sourceBundleId: 'bundle-1',
        name: ' ',
      })
    ).rejects.toThrow('Clone name is required.');
  });
});

describe('upsertBundleRule catalog validation', () => {
  it('rejects unsupported template keys before opening a transaction', async () => {
    await expect(
      upsertBundleRule(poisonedKnex(), {
        tenant: 'tenant-a',
        bundleId: 'bundle-1',
        revisionId: 'rev-1',
        resourceType: 'ticket',
        action: 'read',
        templateKey: 'definitely-not-a-template',
      })
    ).rejects.toThrow(/Unsupported authorization template key/);
  });

  it('rejects unsupported constraint keys before opening a transaction', async () => {
    await expect(
      upsertBundleRule(poisonedKnex(), {
        tenant: 'tenant-a',
        bundleId: 'bundle-1',
        revisionId: 'rev-1',
        resourceType: 'ticket',
        action: 'read',
        templateKey: 'own',
        constraintKey: 'drop-all-guards',
      })
    ).rejects.toThrow(/Unsupported authorization constraint key/);
  });
});

describe('resolveBundleNarrowingRulesForEvaluation fail-closed identity guards', () => {
  it('returns no rules (instead of querying) when the subject has no tenant', async () => {
    await expect(
      resolveBundleNarrowingRulesForEvaluation(poisonedKnex(), evaluationInput({ tenant: '' }))
    ).resolves.toEqual([]);
  });

  it('returns no rules (instead of querying) when the subject has no user id', async () => {
    await expect(
      resolveBundleNarrowingRulesForEvaluation(poisonedKnex(), evaluationInput({ userId: '' }))
    ).resolves.toEqual([]);
  });
});
