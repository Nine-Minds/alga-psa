import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeResource: vi.fn(),
  getByIds: vi.fn(),
  getMaskedByIds: vi.fn(),
  table: vi.fn(),
}));

function queryFor(tableName: string): any {
  const builder: any = new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return undefined;
      if (property === 'first') return async () => undefined;
      if (property === 'select') return async () => tableName === 'projects'
        ? [{ project_id: 'redacted-project', assigned_to: null, client_id: 'client-1' }]
        : [];
      return () => builder;
    },
  });
  return builder;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => (...args: any[]) => action(
    { user_id: 'user-1', user_type: 'internal', roles: [{ role_id: 'role-1' }] },
    { tenant: 'tenant-1' },
    ...args,
  ),
  withOptionalAuth: (action: any) => action,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, callback: (trx: unknown) => unknown) => callback({ raw: (sql: string) => sql }),
  tenantDb: () => ({ table: (name: string) => { mocks.table(name); return queryFor(name); } }),
  registerAfterCommit: vi.fn(),
}));
vi.mock('@alga-psa/authorization/kernel', () => ({
  BuiltinAuthorizationKernelProvider: class {},
  BundleAuthorizationKernelProvider: class {},
  RequestLocalAuthorizationCache: class {},
  createAuthorizationKernel: () => ({ authorizeResource: mocks.authorizeResource }),
}));
vi.mock('@alga-psa/authorization/bundles/service', () => ({ resolveBundleNarrowingRulesForEvaluation: async () => [] }));
vi.mock('../models/project', () => ({ default: {
  getByIds: mocks.getByIds,
  getMaskedByIds: mocks.getMaskedByIds,
} }));

import { getProject } from './projectActions';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeResource.mockResolvedValue({ allowed: true, redactedFields: ['description', 'client_name'] });
  mocks.getMaskedByIds.mockResolvedValue([{
    project_id: 'redacted-project', project_name: 'Restricted project', description: null, client_name: null,
  }]);
  mocks.getByIds.mockResolvedValue([{
    project_id: 'redacted-project', project_name: 'Restricted project', description: 'Protected description', client_name: 'Protected client',
  }]);
});

describe('ordinary project action field redaction', () => {
  it('does not return protected project or client metadata for an allowed redacted detail read', async () => {
    await expect(getProject('redacted-project')).resolves.toMatchObject({
      project_id: 'redacted-project',
      project_name: 'Restricted project',
      description: null,
      client_name: null,
    });
    expect(mocks.getMaskedByIds).toHaveBeenCalledWith(expect.anything(), 'tenant-1', ['redacted-project'], ['client_name', 'description']);
    expect(mocks.getByIds).not.toHaveBeenCalled();
  });

  it('does not fetch a resource projection after a deny decision', async () => {
    mocks.authorizeResource.mockResolvedValue({ allowed: false, redactedFields: [] });
    await expect(getProject('redacted-project')).resolves.toBeNull();
    expect(mocks.getByIds).not.toHaveBeenCalled();
    expect(mocks.getMaskedByIds).not.toHaveBeenCalled();
  });
});
