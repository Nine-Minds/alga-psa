import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// createClientScopeContext with a built-in resolver (a co-managed seat) and no published bundle assignment.
const state = vi.hoisted(() => ({
  probe: { publishedAssignments: false, portfolios: false, resolverSubjects: true } as Record<string, boolean>,
  subject: {} as Record<string, unknown>,
  existenceQueries: 0,
  rowExists: false,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => {
      const b: any = {
        where: () => b,
        andWhere: (fn: any) => { fn.call(b); return b; },
        whereRaw: () => b,
        whereNotNull: () => b,
        first: async () => {
          state.existenceQueries += 1;
          return state.rowExists ? { ok: 1 } : undefined;
        },
      };
      return b;
    },
  }),
}));

vi.mock('../subject/index', () => ({
  probeTenantAuthorizationScope: vi.fn(async () => state.probe),
  resolveAuthorizationSubject: vi.fn(async () => state.subject),
}));

vi.mock('../bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => []),
}));

vi.mock('../kernel/relationshipTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../kernel/relationshipTemplates')>();
  // The compiler is not under test here: the seat's rows are "in scope" only when state.rowExists says so.
  return { ...actual, compileResourceReadAuthorizationSql: vi.fn(() => ({ supported: true })) };
});

import { createClientScopeContext } from '../clientScopeAuthorization';
import { registerBuiltinRuleResolver, resetBuiltinRuleResolversForTests } from '../kernel/builtinRuleResolvers';

const SEAT_ID = 'co_managed_seat';
const seatResolver: any = {
  id: SEAT_ID,
  baseline: 'closed',
  appliesTo: (input: any) => Boolean(input.subject.resolverFacts?.[SEAT_ID]),
  resolveRules: (input: any) => {
    const f = input.subject.resolverFacts?.[SEAT_ID];
    return f
      ? ['client', 'contact'].map((resource) => ({
          id: `seat:${resource}:read`, resource, action: 'read', templateKey: 'selected_clients', selectedClientIds: [f.clientId],
        }))
      : [];
  },
};
const USER: any = { user_id: 'u1', user_type: 'internal' };

describe('createClientScopeContext: built-in resolvers narrow without a published bundle', () => {
  beforeAll(() => {
    resetBuiltinRuleResolversForTests();
    registerBuiltinRuleResolver(seatResolver);
  });
  afterAll(() => resetBuiltinRuleResolversForTests());
  beforeEach(() => {
    state.existenceQueries = 0;
    state.rowExists = false;
    state.probe = { publishedAssignments: false, portfolios: false, resolverSubjects: true };
  });

  it('a seat subject is narrowed and may not read another client or contact', async () => {
    state.subject = { tenant: 't', userId: 'u1', userType: 'internal', resolverFacts: { [SEAT_ID]: { clientId: 'own' } } };
    const ctx = await createClientScopeContext({} as any, 't', USER);
    for (const resource of ['client', 'contact'] as const) {
      expect((await ctx.narrowing(resource)).narrowed).toBe(true);
      expect(await ctx.permits(resource, 'other')).toBe(false);
    }
    expect(state.existenceQueries).toBe(2);
  });

  it('a seat subject still reads a row its predicate admits', async () => {
    state.subject = { tenant: 't', userId: 'u1', userType: 'internal', resolverFacts: { [SEAT_ID]: { clientId: 'own' } } };
    state.rowExists = true;
    const ctx = await createClientScopeContext({} as any, 't', USER);
    expect(await ctx.permits('client', 'own')).toBe(true);
  });

  it('a non-seat subject in the same tenant is not narrowed', async () => {
    state.subject = { tenant: 't', userId: 'u2', userType: 'internal' };
    const ctx = await createClientScopeContext({} as any, 't', USER);
    for (const resource of ['client', 'contact'] as const) {
      expect((await ctx.narrowing(resource)).narrowed).toBe(false);
      expect(await ctx.permits(resource, 'other')).toBe(true);
    }
    expect(state.existenceQueries).toBe(0);
  });

  it('fast path: no published assignment and no resolver subjects resolves nothing', async () => {
    state.probe = { publishedAssignments: false, portfolios: false, resolverSubjects: false };
    const { resolveAuthorizationSubject } = await import('../subject/index');
    vi.mocked(resolveAuthorizationSubject).mockClear();
    const ctx = await createClientScopeContext({} as any, 't', USER);
    expect((await ctx.narrowing('client')).narrowed).toBe(false);
    expect(await ctx.permits('client', 'x')).toBe(true);
    expect(resolveAuthorizationSubject).not.toHaveBeenCalled();
  });
});
