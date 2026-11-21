import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequestLocalAuthorizationCache } from '../../kernel/requestCache';

// T005 (unit half): the tenant fast path skips the portfolio read and the rule load, and a tenant
// with a portfolio row or a published assignment, or a probe that cannot be trusted, takes the slow path.

const state = vi.hoisted(() => ({
  statements: [] as string[],
  portfolioReads: 0,
  scope: { publishedAssignments: false, portfolios: false } as { publishedAssignments: boolean; portfolios: boolean },
}));

vi.mock('@alga-psa/db', () => {
  const table = (name: string) => {
    const chain: any = {
      where: () => chain,
      select: async () => {
        state.statements.push(name);
        return [];
      },
    };
    return chain;
  };
  return { tenantDb: () => ({ table }) };
});

vi.mock('../../portfolios/service', () => ({
  readUserClientPortfolio: vi.fn(async () => {
    state.portfolioReads += 1;
    return ['client-stored'];
  }),
}));

vi.mock('../../subject/tenantScope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../subject/tenantScope')>();
  return { ...actual, probeTenantAuthorizationScope: vi.fn(async () => state.scope) };
});

import { resolveAuthorizationSubject } from '../../subject/resolver';
import { SLOW_PATH_TENANT_SCOPE, peekTenantAuthorizationScope, probeTenantAuthorizationScope } from '../../subject/tenantScope';
import { resolveBundleNarrowingRulesForEvaluation } from '../../bundles/service';

const USER = { user_id: 'user-1', user_type: 'internal', roles: [{ role_id: 'role-1' }] };

describe('subject resolver: tenant fast path', () => {
  beforeEach(() => {
    state.statements.length = 0;
    state.portfolioReads = 0;
    state.scope = { publishedAssignments: false, portfolios: false };
  });

  it('skips the portfolio read when the tenant has no portfolio rows, and the subject has an empty portfolio', async () => {
    const subject = await resolveAuthorizationSubject({} as any, { tenant: 't', user: USER });
    expect(state.portfolioReads).toBe(0);
    expect(subject.portfolioClientIds).toEqual([]);
    expect(subject.roleIds).toEqual(['role-1']);
    // roles came with the user: only teams and managed users were read.
    expect(state.statements).toEqual(['team_members', 'users']);
  });

  it('reads the stored portfolio once the tenant has a portfolio row', async () => {
    state.scope = { publishedAssignments: false, portfolios: true };
    const subject = await resolveAuthorizationSubject({} as any, { tenant: 't', user: USER });
    expect(state.portfolioReads).toBe(1);
    expect(subject.portfolioClientIds).toEqual(['client-stored']);
  });

  it('a published assignment alone does not change the portfolio read (there is no portfolio to read)', async () => {
    state.scope = { publishedAssignments: true, portfolios: false };
    await resolveAuthorizationSubject({} as any, { tenant: 't', user: USER });
    expect(state.portfolioReads).toBe(0);
  });

  describe('rule loading', () => {
    const input = (cache?: RequestLocalAuthorizationCache) => ({
      subject: { tenant: 't', userId: 'user-1', userType: 'internal' as const },
      resource: { type: 'ticket', action: 'read' },
      requestCache: cache,
    });
    // A knex that fails if the loader touches it at all.
    const untouchable: any = new Proxy({}, { get: () => { throw new Error('statement issued'); } });

    it('issues no statement when this request learned the tenant has no published assignment', async () => {
      const cache = new RequestLocalAuthorizationCache();
      cache.set('authorization:tenant-scope:t', { publishedAssignments: false, portfolios: false });
      await expect(resolveBundleNarrowingRulesForEvaluation(untouchable, input(cache))).resolves.toEqual([]);
    });

    // The stubbed `tenantDb` cannot run the assignment query; reaching the role lookup is the evidence
    // that the loader did not take the fast path.
    const reachesDatabase = async (run: () => Promise<unknown>) => {
      state.statements.length = 0;
      await run().catch(() => undefined);
      return state.statements.includes('user_roles');
    };

    it('loads rules when the tenant has published assignments, when nothing was probed, and when locks are retained', async () => {
      const withAssignments = new RequestLocalAuthorizationCache();
      withAssignments.set('authorization:tenant-scope:t', { publishedAssignments: true, portfolios: false });
      expect(await reachesDatabase(() => resolveBundleNarrowingRulesForEvaluation({} as any, input(withAssignments)))).toBe(true);
      expect(await reachesDatabase(() => resolveBundleNarrowingRulesForEvaluation({} as any, input(new RequestLocalAuthorizationCache())))).toBe(true);
      expect(await reachesDatabase(() => resolveBundleNarrowingRulesForEvaluation({} as any, input()))).toBe(true);

      const fast = new RequestLocalAuthorizationCache();
      fast.set('authorization:tenant-scope:t', { publishedAssignments: false, portfolios: false });
      expect(await reachesDatabase(() => resolveBundleNarrowingRulesForEvaluation({ isTransaction: true } as any, input(fast), { lock: true }))).toBe(true);
    });
  });
});

describe('tenant scope probe', () => {
  it('reports the slow path, uncached, when the probe statement fails', async () => {
    const cache = new RequestLocalAuthorizationCache();
    const actual = await vi.importActual<typeof import('../../subject/tenantScope')>('../../subject/tenantScope');
    const failing: any = { queryBuilder: () => { throw new Error('probe failed'); }, raw: () => ({}) };
    expect(await actual.probeTenantAuthorizationScope(failing, 't', cache)).toEqual(SLOW_PATH_TENANT_SCOPE);
    expect(peekTenantAuthorizationScope(cache, 't')).toBeUndefined();
    expect(probeTenantAuthorizationScope).toBeDefined();
  });
});
