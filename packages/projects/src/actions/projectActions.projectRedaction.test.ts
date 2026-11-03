import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [{ project_id: 'p1', project_name: 'Visible', description: 'secret', client_id: 'c1', assigned_to: 'u1' }],
  enrichedInput: [] as any[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 'tenant' }, ...args),
  withOptionalAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 'tenant' }, ...args),
}));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: unknown, fn: (trx: unknown) => unknown) => fn({}),
  tenantDb: () => ({}), registerAfterCommit: vi.fn(),
}));
vi.mock('../models/project', () => ({ default: {
  getAllRecords: async () => h.rows,
  getByIdRecord: async () => h.rows[0],
  enrichDisplayData: async (_trx: unknown, _tenant: string, records: any[]) => {
    h.enrichedInput = records;
    return records.map((record) => ({ ...record, description: 'restored secret', client_name: 'restored client' }));
  },
} }));
vi.mock('../lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async () => async () => ({ allowed: true, redactedFields: ['*'] }),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));

import { getProject, getProjects } from './projectActions';

describe('project list/detail authorization and enrichment', () => {
  beforeEach(() => { h.enrichedInput = []; });

  it('list projects cannot regain wildcard-redacted values through display enrichment', async () => {
    const projects = await getProjects();
    expect(h.enrichedInput).toEqual([{}]);
    expect(projects).toEqual([{}]);
  });

  it('project detail cannot regain wildcard-redacted values through display enrichment', async () => {
    const project = await getProject('p1');
    expect(h.enrichedInput).toEqual([{}]);
    expect(project).toEqual({});
  });
});
