import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, any>[],
  decision: (row: Record<string, any>) => ({ allowed: true, redactedFields: [] as string[] }),
}));
const CREATED_AT = new Date();

vi.mock('@/lib/api/controllers/authorizationKernel', () => ({
  authorizeApiResourceRead: vi.fn(async ({ recordContext, resource }: any) => {
    const row = state.rows.find((candidate) => candidate.project_id === recordContext.id) ?? { project_id: recordContext.id };
    return state.decision({ ...row, resource });
  }),
}));
vi.mock('@/lib/db', () => ({ runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()) }));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@alga-psa/db', async (original) => ({
  ...(await original<typeof import('@alga-psa/db')>()),
  tenantDb: vi.fn((_knex: unknown, _tenant: string) => ({
    table: (name: string) => ({
      whereIn: () => ({ select: async () => name === 'statuses' ? [{ status_id: 's1', name: 'Active' }] : [{ client_id: 'c1', client_name: 'Acme' }] }),
    }),
  })),
}));
vi.mock('@/lib/api/services/ProjectService', () => ({ ProjectService: class {} }));

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const row = (id: string) => ({ project_id: id, project_name: 'Migration', description: 'Secret', client_id: 'c1', client_name: 'Acme', assigned_to: 'u1', assigned_user_name: 'Alex', status: 's1', end_date: '2020-01-01', updated_at: '2020-01-02', created_at: CREATED_AT });
const request = (url: string) => new NextRequest(`http://localhost${url}`, { headers: { 'x-api-key': 'key' } });

function controller() {
  const instance = new ApiProjectController() as any;
  instance.authenticate = async (request: any) => {
    request.context = { tenant: 'tenant-1', user: { user_id: 'u1' }, apiKeyId: 'key' };
    return request;
  };
  instance.checkPermission = async () => undefined;
  instance.extractIdFromPath = async () => state.rows[0]?.project_id;
  instance.projectService = {
    getById: async () => state.rows[0],
    list: async ({ page }: any) => ({ data: page === 1 ? state.rows : [], total: state.rows.length }),
    searchProjects: async () => state.rows,
    exportProjects: async () => state.rows,
  };
  return instance;
}

beforeEach(() => {
  state.rows = [row('p1'), row('p2')];
  state.decision = (candidate) => candidate.project_id === 'p2'
    ? { allowed: true, redactedFields: ['projects.description', 'values.client_id', 'projects.assigned_to'] }
    : { allowed: true, redactedFields: [] };
});

describe('project REST authorization response projection', () => {
  it('projects get, list and search responses and suppresses hidden identifiers', async () => {
    state.decision = () => ({ allowed: true, redactedFields: ['projects.description', 'values.client_id'] });
    const allowedGet = await controller().getById()(request('/api/v1/projects/p1'));
    const allowedGetBody = await allowedGet.json();
    expect(allowedGetBody.data).not.toHaveProperty('description');
    expect(allowedGetBody.data).not.toHaveProperty('client_id');
    expect(allowedGetBody.data).not.toHaveProperty('client_name');

    state.decision = (candidate) => candidate.project_id === 'p1'
      ? { allowed: true, redactedFields: ['values.project_id'] }
      : { allowed: true, redactedFields: ['projects.description', 'values.client_id', 'projects.assigned_to'] };
    const instance = controller();
    const get = await instance.getById()(request('/api/v1/projects/p1'));
    expect(get.status).toBe(404);
    for (const response of [await instance.list()(request('/api/v1/projects')), await instance.search()(request('/api/v1/projects/search?query=Migration'))]) {
      const body = await response.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).not.toHaveProperty('description');
      expect(body.data[0]).not.toHaveProperty('client_id');
      expect(body.data[0]).not.toHaveProperty('client_name');
      expect(body.data[0]).not.toHaveProperty('assigned_user_name');
      expect(body.data[0].created_at).toBe(CREATED_AT.toJSON());
    }
  });

  it('projects JSON and CSV exports with source and derived aliases removed', async () => {
    state.rows = [row('p2')];
    const instance = controller();
    const json = await instance.export()(request('/api/v1/projects/export?format=json'));
    const body = await json.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).not.toHaveProperty('client_name');
    expect(body.data[0]).not.toHaveProperty('assigned_user_name');
    expect(body.data[0].created_at).toBe(CREATED_AT.toJSON());
    const csv = await instance.export()(request('/api/v1/projects/export?format=csv'));
    const text = await csv.text();
    expect(text).not.toContain('Secret');
    expect(text).not.toContain('Acme');
    expect(text).toContain('Migration');
  });

  it('preserves unrestricted aggregate counts and omits aggregates with hidden source dependencies', async () => {
    state.rows = [row('p1')];
    state.decision = () => ({ allowed: true, redactedFields: [] });
    const unrestricted = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
    expect(unrestricted.data).toMatchObject({ active_projects: 1, overdue_projects: 1, projects_by_status: { Active: 1 }, top_clients_by_project_count: [{ client_name: 'Acme', project_count: 1 }] });
    expect(unrestricted.data.projects_created_this_month).toBe(1);
    state.decision = () => ({ allowed: true, redactedFields: ['projects.status', 'projects.client_id'] });
    const redacted = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
    expect(redacted.data).not.toHaveProperty('active_projects');
    expect(redacted.data).not.toHaveProperty('projects_by_status');
    expect(redacted.data).not.toHaveProperty('top_clients_by_project_count');
    state.decision = () => ({ allowed: true, redactedFields: ['values.client_name'] });
    const hiddenClient = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
    expect(hiddenClient.data).not.toHaveProperty('top_clients_by_project_count');
    state.rows = [row('p1'), row('p2')];
    state.decision = (candidate) => ({ allowed: true, redactedFields: candidate.project_id === 'p2' ? ['values.client_name'] : [] });
    const mixed = await (await controller().stats()(request('/api/v1/projects/stats'))).json();
    expect(mixed.data).not.toHaveProperty('top_clients_by_project_count');
  });
});
