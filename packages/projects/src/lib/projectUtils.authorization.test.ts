import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  permission: true,
  decision: { allowed: true, redactedFields: [] as string[] },
  queriedMetrics: false,
  projectIdentity: { project_id: 'p1', client_id: 'c1', assigned_to: null },
}));

function query(table: string) {
  let selected: string[] = [];
  const builder: any = {
    where: () => builder,
    select: (...columns: string[]) => { selected = columns; return builder; },
    first: async () => {
      if (table !== 'projects') return undefined;
      return selected.includes('budgeted_hours')
        ? (state.queriedMetrics = true, { budgeted_hours: 731 })
        : state.projectIdentity;
    },
    then: (resolve: (value: any[]) => unknown, reject: (error: unknown) => unknown) => {
      state.queriedMetrics = true;
      const rows = table === 'project_tasks' ? [{ is_closed: true }, { is_closed: false }] : [{ billable_duration: 60 }];
      return Promise.resolve(rows).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: Function) => (...args: any[]) => handler({ user_id: 'u1', user_type: 'internal', roles: [] }, { tenant: 't1' }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => state.permission }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  tenantDb: () => ({ table: (table: string) => query(table), tenantJoin: () => undefined }),
  withTransaction: async (_db: unknown, run: Function) => run({ raw: () => ({}) }),
}));
vi.mock('./projectReadAuthorization', () => ({
  createProjectReadDecider: async () => async () => state.decision,
}));

import { calculateProjectCompletion } from './projectUtils';

describe('calculateProjectCompletion authorization', () => {
  beforeEach(() => {
    state.permission = true;
    state.decision = { allowed: true, redactedFields: [] };
    state.queriedMetrics = false;
  });

  it('denies coarse permission before project or metric reads', async () => {
    state.permission = false;
    await expect(calculateProjectCompletion('p1')).rejects.toThrow('Permission denied');
    expect(state.queriedMetrics).toBe(false);
  });

  it('denies excluded records before loading task and time metrics', async () => {
    state.decision = { allowed: false, redactedFields: [] };
    await expect(calculateProjectCompletion('p1')).rejects.toThrow('Permission denied');
    expect(state.queriedMetrics).toBe(false);
  });

  it.each(['budgeted_hours', 'fields.budgeted_hours', '*', 'fields'])('omits budget and derived metrics for redaction %s', async (redaction) => {
    state.decision = { allowed: true, redactedFields: [redaction] };
    const result = await calculateProjectCompletion('p1');
    expect(result).toEqual({
      taskCompletionPercentage: 50,
      hoursCompletionPercentage: null,
      totalTasks: 2,
      completedTasks: 1,
      budgetedHours: null,
      spentHours: 1,
      remainingHours: null,
    });
  });

  it('preserves authorized unredacted metric values', async () => {
    await expect(calculateProjectCompletion('p1')).resolves.toEqual({
      taskCompletionPercentage: 50,
      hoursCompletionPercentage: (1 / (731 / 60)) * 100,
      totalTasks: 2,
      completedTasks: 1,
      budgetedHours: 731 / 60,
      spentHours: 1,
      remainingHours: 731 / 60 - 1,
    });
  });
});
