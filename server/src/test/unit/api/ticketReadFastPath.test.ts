import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({ bundleRules: [] as any[], builtinRedactions: [] as string[] }));
const resolveFieldRedactions = vi.hoisted(() => vi.fn(async () => state.builtinRedactions));

vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({ resolveFieldRedactions, authorizeResource: vi.fn() })),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: vi.fn(async () => state.bundleRules),
}));
vi.mock('@alga-psa/authorization/kernel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/authorization/kernel')>()),
  resolveDefaultBuiltinRelationshipRules: vi.fn(() => []),
  compileTenantScopedResourceReadAuthorizationSql: vi.fn(() => ({ supported: true })),
}));
vi.mock('@alga-psa/tickets/lib/ticketAuthorizationSql', () => ({ createTicketRelationshipSqlAdapter: vi.fn(() => ({})) }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  tenantDb: vi.fn(() => ({ scoped: () => ({}) })),
}));

import { resolveTicketReadAuthorizationApplier } from '../../../lib/api/controllers/ApiTicketController';

const request = { context: { tenant: 't-1', user: { user_id: 'u-1', user_type: 'internal' }, apiKeyId: undefined } } as any;

describe('ticket read SQL fast path', () => {
  beforeEach(() => {
    state.bundleRules = [];
    state.builtinRedactions = [];
  });

  it('is used when nothing redacts', async () => {
    expect(await resolveTicketReadAuthorizationApplier(request, {} as any)).toBeTypeOf('function');
  });

  it('is skipped when only the builtin provider redacts fields', async () => {
    state.builtinRedactions = ['tickets.description'];
    expect(await resolveTicketReadAuthorizationApplier(request, {} as any)).toBeNull();
  });

  it('is skipped when a bundle rule redacts fields', async () => {
    state.bundleRules = [{ redactedFields: ['title'] }];
    expect(await resolveTicketReadAuthorizationApplier(request, {} as any)).toBeNull();
  });
});
