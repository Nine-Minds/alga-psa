import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBuiltinRuleResolver, unregisterBuiltinRuleResolver } from '@alga-psa/authorization/kernel';
import { ApiQuoteController } from '../../../lib/api/controllers/ApiQuoteController';

const state = vi.hoisted(() => ({ restricted: true, subjectCache: undefined as unknown, bundleCaches: [] as unknown[] }));
vi.mock('@/lib/db/db', () => ({ getConnection: async () => ({}) }));
vi.mock('@alga-psa/authorization/quoteSelfApproval', () => ({ resolveAllowSelfApprovalFlag: async () => true }));
vi.mock('@alga-psa/authorization/subject', async (original) => ({
  ...await original<typeof import('@alga-psa/authorization/subject')>(),
  resolveAuthorizationSubject: async (_knex: unknown, input: any) => {
    state.subjectCache = input.requestCache;
    return {
      tenant: input.tenant, userId: input.user.user_id, userType: 'internal',
      roleIds: [], teamIds: [], managedUserIds: [], portfolioClientIds: [],
      apiKeyId: input.apiKeyId,
      resolverFacts: { 'quote-approval-review': { restricted: state.restricted } },
    };
  },
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async (_knex: unknown, input: any) => {
    state.bundleCaches.push(input.requestCache);
    return [];
  },
}));
beforeEach(() => {
  state.restricted = true;
  state.subjectCache = undefined;
  state.bundleCaches = [];
  registerBuiltinRuleResolver({
    id: 'quote-approval-review', baseline: 'closed',
    appliesTo: ({ subject }) => subject.resolverFacts?.['quote-approval-review']?.restricted === true,
    resolveRules: () => [{ id: 'read-only', resource: 'billing', action: 'read' }],
  });
});
afterEach(() => unregisterBuiltinRuleResolver('quote-approval-review'));
const request = { context: { tenant: 'tenant-1', user: { user_id: 'approver', user_type: 'internal' }, apiKeyId: 'approval-key' } };
const quote = { quote_id: 'quote-1', created_by: 'author', client_id: 'client-1' };

describe('quote approval retains resolved subject restrictions', () => {
  it('denies approval when the resolved subject can read but its closed baseline excludes approve', async () => {
    await expect((new ApiQuoteController() as any).assertQuoteApproveAllowed(request, quote)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('preserves unrestricted approvals and shares the subject cache with rule evaluation', async () => {
    state.restricted = false;
    await expect((new ApiQuoteController() as any).assertQuoteApproveAllowed(request, quote)).resolves.toEqual({ selfApproved: false });
    expect(state.subjectCache).toBeDefined();
    expect(state.bundleCaches.length).toBeGreaterThan(0);
    expect(state.bundleCaches.every(cache => cache === state.subjectCache)).toBe(true);
  });
});
