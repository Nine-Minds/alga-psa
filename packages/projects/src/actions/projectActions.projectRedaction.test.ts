import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  rows: [{ project_id: 'p1', project_name: 'Visible', description: 'secret', client_id: 'c1', assigned_to: 'u1' }],
  enrichedInput: [] as any[],
  decision: { allowed: true, redactedFields: ['*'] },
  update: vi.fn(),
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
  getByIdsRecords: async () => h.rows,
  getById: async () => h.rows[0],
  update: h.update,
  enrichDisplayData: async (_trx: unknown, _tenant: string, records: any[]) => {
    h.enrichedInput = records;
    return records.map((record) => ({ ...record, description: 'restored secret', client_name: 'restored client' }));
  },
} }));
vi.mock('../lib/projectReadAuthorization', () => ({
  createProjectReadAuthorizer: async () => async () => h.decision,
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/tags/models/tagMapping', () => ({ default: { getByEntities: async () => [] } }));

import { getProject, getProjects, loadProjectListItemsByIds, updateProject } from './projectActions';

describe('project list/detail authorization and enrichment', () => {
  beforeEach(() => {
    h.enrichedInput = [];
    h.decision = { allowed: true, redactedFields: ['*'] };
    h.update.mockClear();
  });

  it('list, detail, and by-id readers omit hidden description and client fields after enrichment', async () => {
    h.decision.redactedFields = ['description', 'client_id'];
    const list = await getProjects();
    const detail = await getProject('p1');
    const byId = await loadProjectListItemsByIds(['p1']);
    for (const project of [list[0], detail, 'projects' in byId ? byId.projects[0] : null]) {
      expect(project).toMatchObject({ project_id: 'p1', project_name: 'Visible' });
      expect(project).not.toHaveProperty('description');
      expect(project).not.toHaveProperty('client_id');
      expect(project).not.toHaveProperty('client_name');
    }
  });

  it('denied records are absent from list and detail results', async () => {
    h.decision = { allowed: false, redactedFields: [] };
    expect(await getProjects()).toEqual([]);
    expect(await getProject('p1')).toBeNull();
  });

  it('rejects updating a redacted field before persisting changes', async () => {
    h.decision.redactedFields = ['description'];
    await expect(updateProject('p1', { description: 'replacement' })).resolves.toEqual({
      permissionError: 'Permission denied: Cannot update redacted project field',
    });
    expect(h.update).not.toHaveBeenCalled();
  });

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
