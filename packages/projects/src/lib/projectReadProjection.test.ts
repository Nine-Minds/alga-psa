import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  decisions: new Map<string, { allowed: boolean; redactedFields: string[] }>(),
  getByIds: vi.fn(),
  getMaskedByIds: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => {
    const query: any = {
      whereIn: () => query,
      select: async () => [
        { project_id: 'redacted', assigned_to: null, client_id: 'client-a' },
        { project_id: 'allowed', assigned_to: null, client_id: 'client-b' },
        { project_id: 'denied', assigned_to: null, client_id: 'client-c' },
      ],
    };
    return query;
  } }),
}));
vi.mock('./projectReadAuthorization', () => ({
  createProjectReadDecider: async () => async (project: { project_id?: string }) =>
    mocks.decisions.get(project.project_id ?? '') ?? { allowed: false, redactedFields: [] },
}));
vi.mock('../models/project', () => ({ default: {
  getByIds: mocks.getByIds,
  getMaskedByIds: mocks.getMaskedByIds,
} }));

import { loadAuthorizedProjectProjections } from './projectReadProjection';

describe('loadAuthorizedProjectProjections', () => {
  beforeEach(() => {
    mocks.decisions.clear();
    mocks.getByIds.mockReset();
    mocks.getMaskedByIds.mockReset();
  });

  it('returns a masked projection for an allowing redacted decision, preserves normal access, and omits denied projects', async () => {
    mocks.decisions.set('redacted', { allowed: true, redactedFields: ['description', 'client_name'] });
    mocks.decisions.set('allowed', { allowed: true, redactedFields: [] });
    mocks.decisions.set('denied', { allowed: false, redactedFields: [] });
    mocks.getMaskedByIds.mockResolvedValue([{
      project_id: 'redacted', project_name: 'Restricted project', description: null, client_name: null,
    }]);
    mocks.getByIds.mockResolvedValue([{
      project_id: 'allowed', project_name: 'Visible project', description: 'Visible description', client_name: 'Visible client',
    }]);

    const result = await loadAuthorizedProjectProjections({} as never, 'tenant', { user_id: 'user' } as never,
      ['redacted', 'allowed', 'denied']);

    expect(result).toEqual([
      { project: { project_id: 'redacted', project_name: 'Restricted project', description: null, client_name: null }, redactedFields: ['description', 'client_name'] },
      { project: { project_id: 'allowed', project_name: 'Visible project', description: 'Visible description', client_name: 'Visible client' }, redactedFields: [] },
    ]);
    expect(mocks.getMaskedByIds).toHaveBeenCalledWith(expect.anything(), 'tenant', ['redacted'], ['client_name', 'description']);
    expect(mocks.getByIds).toHaveBeenCalledWith(expect.anything(), 'tenant', ['allowed']);
  });
});
