import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  users: new Map<string, any>(),
  coarseDenied: new Set<string>(),
  recordDenied: new Set<string>(),
  missingProject: new Set<string>(),
  failure: null as Error | null,
}));

vi.mock('@alga-psa/db', () => ({
  getUserWithRoles: vi.fn(async (userId: string) => state.users.get(userId) ?? null),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: vi.fn(async (user: any) => !state.coarseDenied.has(user.user_id)),
}));
vi.mock('@alga-psa/projects/lib/projectReadAuthorization', () => ({
  assertProjectReadAllowed: vi.fn(async (_db: unknown, _tenant: string, user: any) => {
    if (state.failure) throw state.failure;
    if (state.missingProject.has(user.user_id)) throw new Error('Project not found');
    if (state.recordDenied.has(user.user_id)) throw new Error('Permission denied: Cannot read project');
  }),
}));

import { filterRecipientsWhoCanReadProject } from '../projectNotificationAudience';

describe('filterRecipientsWhoCanReadProject', () => {
  beforeEach(() => {
    state.users = new Map([
      ['allowed', { user_id: 'allowed', roles: [] }],
      ['record-denied', { user_id: 'record-denied', roles: [] }],
      ['coarse-denied', { user_id: 'coarse-denied', roles: [] }],
      ['missing-project', { user_id: 'missing-project', roles: [] }],
    ]);
    state.coarseDenied = new Set(['coarse-denied']);
    state.recordDenied = new Set(['record-denied']);
    state.missingProject = new Set(['missing-project']);
    state.failure = null;
  });

  it('keeps readable users and drops record denied, coarse denied, missing, and project missing recipients', async () => {
    await expect(filterRecipientsWhoCanReadProject({} as any, 'tenant', 'resolved-project', [
      'allowed', 'record-denied', 'coarse-denied', 'missing-user', 'missing-project',
    ])).resolves.toEqual(['allowed']);
  });

  it('propagates unexpected authorization or database failures', async () => {
    state.failure = new Error('database unavailable');
    await expect(filterRecipientsWhoCanReadProject({} as any, 'tenant', 'project', ['allowed']))
      .rejects.toThrow('database unavailable');
  });
});
