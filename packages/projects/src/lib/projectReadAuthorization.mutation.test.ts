import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rules: [] as Array<{ id: string; resource: string; action: string; templateKey?: string }>,
  project: { project_id: 'P1', assigned_to: 'someone-else', client_id: 'C1' },
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => ({
      where() { return this; },
      select: async () => [],
    }),
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => state.rules,
}));

vi.mock('../models/project', () => ({
  default: { getById: async () => state.project },
}));

import { assertProjectMutationAllowed, assertProjectReadAllowed } from './projectReadAuthorization';

const conn = {} as never;
const user = { user_id: 'user-1', user_type: 'internal', roles: ['role-1'] } as never;

const rule = (action: 'read' | 'update' | 'delete') => ({
  id: `${action}-own-assigned`,
  resource: 'project',
  action,
  templateKey: 'own_or_assigned',
});

beforeEach(() => {
  state.project = { project_id: 'P1', assigned_to: 'someone-else', client_id: 'C1' };
  state.rules = [];
});

describe('project mutation record authorization', () => {
  it('allows read scope but blocks an update denied by the update bundle rule', async () => {
    state.rules = [rule('update')];

    await expect(assertProjectMutationAllowed(conn, 'tenant-1', user, 'P1', 'update'))
      .rejects.toThrow('Permission denied: Cannot update project');
  });

  it('honors the delete action instead of evaluating the update rule', async () => {
    state.rules = [rule('delete')];

    await expect(assertProjectMutationAllowed(conn, 'tenant-1', user, 'P1', 'delete'))
      .rejects.toThrow('Permission denied: Cannot delete project');
  });

  it('keeps read restrictions in force when the requested write action has no narrowing rule', async () => {
    state.rules = [rule('read')];

    await expect(assertProjectMutationAllowed(conn, 'tenant-1', user, 'P1', 'update'))
      .rejects.toThrow('Permission denied: Cannot read project');
  });

  it.each(['update', 'delete'] as const)('allows a %s when both read and write scopes allow it', async (action) => {
    state.project.assigned_to = 'user-1';
    state.rules = [rule('read'), rule(action)];

    await expect(assertProjectMutationAllowed(conn, 'tenant-1', user, 'P1', action))
      .resolves.toMatchObject({ project_id: 'P1' });
  });

  it('keeps ordinary reads read-scoped', async () => {
    state.rules = [rule('update')];

    await expect(assertProjectReadAllowed(conn, 'tenant-1', user, 'P1'))
      .resolves.toMatchObject({ project_id: 'P1' });
  });
});
