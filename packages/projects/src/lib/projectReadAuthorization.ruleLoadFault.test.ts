import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// T006 (project half): with the bundle-rule loader throwing, project reads are denied. The kernel and
// the bundle provider are real; only the database and the rule query are faked.
const state = vi.hoisted(() => ({
  resolveBundleRules: async (..._args: any[]) => [] as any[],
  loadCalls: 0,
  failingTable: null as string | null,
  project: { project_id: 'p1', client_id: 'c1', assigned_to: null } as Record<string, unknown> | null,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => ({
      where: () => ({
        select: async () => {
          if (table === state.failingTable) throw new Error(`${table} lookup failed`);
          return [];
        },
      }),
    }),
  }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: (...args: any[]) => {
    state.loadCalls += 1;
    return state.resolveBundleRules(...args);
  },
}));
vi.mock('../models/project', () => ({ default: { getById: async () => state.project } }));

import { assertProjectReadAllowed, createProjectReadAuthorizer, createProjectReadDecider } from './projectReadAuthorization';

const user = { user_id: 'u1', user_type: 'internal', roles: [{ role_id: 'r1' }] } as never;
const userWithoutLoadedRoles = { user_id: 'u1', user_type: 'internal', roles: [] } as never;
const conn = {} as never;
const project = { project_id: 'p1', client_id: 'c1', assigned_to: null };

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

describe('project reads when bundle rules cannot be loaded (T006)', () => {
  it('allows the same read while rules load, so the denial below is the fault and nothing else', async () => {
    const decide = await createProjectReadDecider(conn, 't1', user);
    await expect(decide(project)).resolves.toEqual({ allowed: true, redactedFields: [] });
    await expect(assertProjectReadAllowed(conn, 't1', user, 'p1')).resolves.toEqual(project);
  });

  it('denies the read, the update and the asserted read', async () => {
    state.resolveBundleRules = async () => { throw new Error('bundle lookup failed'); };

    const decide = await createProjectReadDecider(conn, 't1', user);
    await expect(decide(project)).resolves.toEqual({ allowed: false, redactedFields: [] });

    const authorizeUpdate = await createProjectReadAuthorizer(conn, 't1', user, 'update');
    await expect(authorizeUpdate(project)).resolves.toBe(false);

    await expect(assertProjectReadAllowed(conn, 't1', user, 'p1')).rejects.toThrow('Permission denied: Cannot read project');
    expect(state.loadCalls).toBe(3);
    expect(errorLog).toHaveBeenCalled();
  });
});

describe('project reads when the subject cannot be resolved', () => {
  it.each(['user_roles', 'team_members', 'users'])('gives no decision when the %s lookup fails', async (table) => {
    state.failingTable = table;
    await expect(createProjectReadDecider(conn, 't1', userWithoutLoadedRoles)).rejects.toThrow(`${table} lookup failed`);
    await expect(assertProjectReadAllowed(conn, 't1', userWithoutLoadedRoles, 'p1')).rejects.toThrow(`${table} lookup failed`);
    expect(state.loadCalls).toBe(0);
  });
});
