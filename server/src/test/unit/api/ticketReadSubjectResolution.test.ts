import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import knexFactory from 'knex';
import { tenantDb } from '@alga-psa/db';
import { RequestLocalAuthorizationCache, registerBuiltinRuleResolver, unregisterBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { resolveTicketReadAuthorizationApplier } from '../../../lib/api/controllers/ApiTicketController';

const state = vi.hoisted(() => ({ restricted: true, subjectCache: undefined as unknown, bundleCache: undefined as unknown, redactionCache: undefined as unknown }));
vi.mock('@alga-psa/authorization/subject', async (original) => ({
  ...await original<typeof import('@alga-psa/authorization/subject')>(),
  resolveAuthorizationSubject: async (_knex: unknown, input: any) => {
    state.subjectCache = input.requestCache;
    return {
      tenant: input.tenant, userId: input.user.user_id, userType: 'internal', roleIds: [], teamIds: [],
      managedUserIds: [], portfolioClientIds: [], resolverFacts: { 'lead-subject-facts': { restricted: state.restricted } },
    };
  },
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async (_knex: unknown, input: any) => {
    state.bundleCache = input.requestCache;
    return [];
  },
}));
vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: async () => ({ resolveFieldRedactions: async (input: any) => {
    state.redactionCache = input.requestCache;
    return [];
  } }),
}));
const db = knexFactory({ client: 'pg' });
afterAll(async () => { await db.destroy(); });
afterEach(() => unregisterBuiltinRuleResolver('lead-subject-facts'));
function register() {
  registerBuiltinRuleResolver({
    id: 'lead-subject-facts', baseline: 'closed',
    appliesTo: ({ subject }) => subject.resolverFacts?.['lead-subject-facts']?.restricted === true,
    resolveRules: () => [],
  });
}
const request = { context: { tenant: 'tenant-1', user: { user_id: 'user-1', user_type: 'internal' } } } as any;
describe('ticket SQL subject parity after architecture port', () => {
  it('retains the closed resolver baseline from resolved subject facts', async () => {
    state.restricted = true;
    register();
    const requestCache = new RequestLocalAuthorizationCache();
    const apply = await resolveTicketReadAuthorizationApplier(request, db, requestCache);
    const query = tenantDb(db, 'tenant-1').scoped('tickets as t');
    apply!(query);
    expect(query.builder.toString()).toContain('1 = 0');
    expect(state.subjectCache).toBe(requestCache);
    expect(state.bundleCache).toBe(requestCache);
    expect(state.redactionCache).toBe(requestCache);
  });
  it('leaves the visible subject unrestricted', async () => {
    state.restricted = false;
    register();
    const apply = await resolveTicketReadAuthorizationApplier(request, db);
    const query = tenantDb(db, 'tenant-1').scoped('tickets as t');
    apply!(query);
    expect(query.builder.toString()).not.toContain('1 = 0');
  });
});
