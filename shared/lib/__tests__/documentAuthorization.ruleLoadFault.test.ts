import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T006 (document half): with the bundle-rule loader throwing, document reads are denied. The kernel and
// the bundle provider are real; only the database, the rule query and the attachment check are faked.
const state = vi.hoisted(() => ({
  resolveBundleRules: async (..._args: any[]) => [] as any[],
  loadCalls: 0,
  failingTable: null as string | null,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => {
      const rows = () => (table === state.failingTable
        ? Promise.reject(new Error(`${table} lookup failed`))
        : Promise.resolve([]));
      const query: any = {
        where: () => query,
        whereIn: () => query,
        orderBy: () => query,
        modify: () => query,
        select: () => query,
        first: async () => undefined,
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => rows().then(resolve, reject),
      };
      return query;
    },
  }),
}));
vi.mock('@alga-psa/authorization/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: any[]) => {
    state.loadCalls += 1;
    return state.resolveBundleRules(...args);
  },
}));
vi.mock('../ticketCommentAttachments', () => ({
  canReadCommentAttachment: async () => true,
  isPublicAttachmentComment: async () => false,
}));

import { authorizeAndRedactDocuments } from '../documentAuthorization';

const trx = {} as any;
const user = { user_id: 'u1', user_type: 'internal', roles: [{ role_id: 'r1' }] } as any;
const userWithoutLoadedRoles = { user_id: 'u1', user_type: 'internal', roles: [] } as any;
const documents = [
  { document_id: 'd1', created_by: 'u1', is_client_visible: false },
  { document_id: 'd2', created_by: 'someone-else', is_client_visible: true },
] as any[];

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  state.resolveBundleRules = async () => [];
  state.loadCalls = 0;
  state.failingTable = null;
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  errorLog.mockRestore();
});

describe('document reads when bundle rules cannot be loaded (T006)', () => {
  it('returns the same documents while rules load, so the denial below is the fault and nothing else', async () => {
    await expect(authorizeAndRedactDocuments(trx, 't1', user, documents)).resolves.toEqual(documents);
  });

  it('returns no documents', async () => {
    state.resolveBundleRules = async () => { throw new Error('bundle lookup failed'); };
    await expect(authorizeAndRedactDocuments(trx, 't1', user, documents)).resolves.toEqual([]);
    expect(state.loadCalls).toBe(documents.length);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });
});

describe('document reads when the subject cannot be resolved', () => {
  it.each(['user_roles', 'team_members', 'users'])('returns nothing when the %s lookup fails', async (table) => {
    state.failingTable = table;
    await expect(authorizeAndRedactDocuments(trx, 't1', userWithoutLoadedRoles, documents)).rejects.toThrow(`${table} lookup failed`);
    expect(state.loadCalls).toBe(0);
  });
});
