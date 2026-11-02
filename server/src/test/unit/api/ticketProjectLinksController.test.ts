import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * GET /api/v1/tickets/{id}/project-links: read on the ticket, then only the
 * links whose projects the caller may read, without the authorization fields.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const TICKET = '22222222-2222-2222-2222-222222222222';
const PROJECT_A = '33333333-3333-3333-3333-333333333333';
const PROJECT_B = '44444444-4444-4444-4444-444444444444';

const state = vi.hoisted(() => ({
  ticket: null as Record<string, unknown> | null,
  links: [] as Record<string, unknown>[],
  permissions: new Set<string>(),
  readable: new Set<string>(),
  hidden: new Set<string>(),
}));

const authorizeResourceMock = vi.hoisted(() => vi.fn(async ({
  resource,
  record,
}: {
  resource: { type: string };
  record: Record<string, unknown>;
}) => {
  const kind = resource.type;
  const id = record.id as string | undefined;
  return {
    allowed: state.readable.has(`${kind}:${id}`),
    redactedFields: [...state.hidden],
  };
}));
const getTicketProjectLinksMock = vi.hoisted(() => vi.fn(async () => state.links));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
    validateApiKeyForTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: 'user-1', user_type: 'internal', tenant: TENANT })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, callback: () => Promise<any>) => callback()),
}));

vi.mock('@/lib/db/db', () => ({
  getConnection: vi.fn(async () => ({})),
}));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  tenantDb: vi.fn(() => ({
    table: () => ({ where: () => ({ first: async () => state.ticket }) }),
  })),
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_user: unknown, resource: string, action: string) => state.permissions.has(`${resource}:${action}`)),
}));

vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: vi.fn(() => false),
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
}));

vi.mock('@/lib/productSurfaceRegistry', () => ({
  resolveProductApiBehavior: vi.fn(() => 'allowed'),
}));

vi.mock('server/src/lib/authorization/kernel', () => ({
  getAuthorizationKernel: vi.fn(async () => ({
    authorizeResource: authorizeResourceMock,
  })),
}));

vi.mock('../../../lib/api/services/ProjectService', () => ({
  ProjectService: class {
    getTicketProjectLinks = getTicketProjectLinksMock;
  },
}));

import { GET } from '../../../app/api/v1/tickets/[id]/project-links/route';

function linkRow(projectId: string, taskName: string) {
  return {
    link_id: `link-${taskName}`,
    project_id: projectId,
    project_name: `Project ${taskName}`,
    project_number: 'PRJ-0001',
    phase_id: 'phase-1',
    phase_name: 'Backlog',
    task_id: `task-${taskName}`,
    task_name: taskName,
    project_status_mapping_id: 'mapping-1',
    status_name: 'Backlog',
    is_closed: false,
    task_updated_at: '2026-10-18T12:00:00.000Z',
    bill_under_project: false,
    created_at: '2026-10-01T12:00:00.000Z',
    project_assigned_to: 'user-9',
    project_client_id: 'client-1',
    project_status: 'status-1',
    project_is_closed: false,
  };
}

const request = (ticketId = TICKET) =>
  new NextRequest(`http://localhost/api/v1/tickets/${ticketId}/project-links`, { headers: { 'x-api-key': 'test-api-key' } });

describe('GET /api/v1/tickets/{id}/project-links', () => {
  beforeEach(() => {
    state.ticket = { ticket_id: TICKET, entered_by: null, assigned_to: null, client_id: 'client-1', board_id: 'board-1', status_id: 'status-1' };
    state.links = [linkRow(PROJECT_A, 'export'), linkRow(PROJECT_B, 'branding'), linkRow(PROJECT_A, 'import')];
    state.permissions = new Set(['project:read', 'ticket:read']);
    state.readable = new Set([`ticket:${TICKET}`, `project:${PROJECT_A}`]);
    state.hidden = new Set();
    authorizeResourceMock.mockClear();
    getTicketProjectLinksMock.mockClear();
  });

  it('returns the links on projects the caller can read, without authorization fields', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.map((l: { task_name: string }) => l.task_name)).toEqual(['export', 'import']);
    expect(body.data[0]).toMatchObject({ project_id: PROJECT_A, task_id: 'task-export', status_name: 'Backlog', is_closed: false });
    for (const field of ['project_assigned_to', 'project_client_id', 'project_status', 'project_is_closed']) {
      expect(body.data[0]).not.toHaveProperty(field);
    }
    expect(getTicketProjectLinksMock).toHaveBeenCalledWith(TICKET, expect.objectContaining({ tenant: TENANT }));
    // The ticket gate and both project decisions are independent. The denied
    // project contributes no link while visible task and status values survive.
    expect(authorizeResourceMock.mock.calls.map(([arg]) => arg.resource.type)).toEqual([
      'ticket', 'project', 'project',
    ]);
  });

  it('serves project-owned values from the project projection, nulling a redacted project name', async () => {
    state.hidden = new Set(['project_name']);
    const body = await (await GET(request())).json();
    expect(body.data.map((l: { project_name: unknown }) => l.project_name)).toEqual([null, null]);
    expect(body.data[0]).toMatchObject({ project_number: 'PRJ-0001', task_name: 'export' });
  });

  it('refuses without ticket or project read permission', async () => {
    state.permissions = new Set(['project:read']);
    expect((await GET(request())).status).toBe(403);
    state.permissions = new Set(['ticket:read']);
    expect((await GET(request())).status).toBe(403);
    expect(getTicketProjectLinksMock).not.toHaveBeenCalled();
  });

  it('refuses a ticket the caller cannot read, and 404s a missing one', async () => {
    state.readable.delete(`ticket:${TICKET}`);
    expect((await GET(request())).status).toBe(404);
    state.ticket = null;
    expect((await GET(request())).status).toBe(404);
    expect(getTicketProjectLinksMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed ticket id', async () => {
    expect((await GET(request('not-a-uuid'))).status).toBe(400);
  });

  it('independent source projection visible control', async () => {
    state.links = [linkRow(PROJECT_A, 'private task')];
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).data[0]).toMatchObject({
      task_name: 'private task', phase_name: 'Backlog', status_name: 'Backlog',
      is_closed: false, task_updated_at: '2026-10-18T12:00:00.000Z',
    });
  });
  it.each([
    ['project_tasks.task_name', 'task_name'],
    ['values.tasks.task_name', 'task_name'],
    ['project_phases.phase_name', 'phase_name'],
    ['values.phases.phase_name', 'phase_name'],
    ['project_status_mappings.custom_name', 'status_name'],
    ['values.status_mappings.custom_name', 'status_name'],
  ])('independent source projection hides %s in link field %s', async (alias, field) => {
    state.links = [linkRow(PROJECT_A, 'private task')];
    state.hidden = new Set([alias]);
    const res = await GET(request());
    expect(res.status).toBe(200);
    const rows = (await res.json()).data;
    expect(rows).toHaveLength(1);
    expect(rows[0][field] ?? null).toBeNull();
  });
  it.each(['project_tasks', 'project_tasks.task_id', 'values.tasks.task_id'])(
    'independent source projection suppresses linked tasks under %s', async alias => {
      state.links = [linkRow(PROJECT_A, 'private task')];
      state.hidden = new Set([alias]);
      const res = await GET(request());
      expect(res.status).toBe(200);
      const rows = (await res.json()).data;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        project_id: PROJECT_A,
        phase_id: 'phase-1',
        phase_name: 'Backlog',
        task_id: null,
        task_name: null,
        project_status_mapping_id: null,
        status_name: null,
        is_closed: null,
        task_updated_at: null,
        bill_under_project: false,
        created_at: '2026-10-01T12:00:00.000Z',
      });
    });
  it.each(['project_phases', 'project_phases.phase_id', 'values.phases.phase_id'])(
    'independent source projection suppresses linked phases under %s', async alias => {
      state.links = [linkRow(PROJECT_A, 'visible task')];
      state.hidden = new Set([alias]);
      const res = await GET(request());
      expect(res.status).toBe(200);
      const rows = (await res.json()).data;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ phase_id: null, phase_name: null });
      expect(rows[0].task_name).toBe('visible task');
    });
  it.each([
    'project_status_mappings',
    'project_status_mappings.project_status_mapping_id',
    'values.status_mappings.project_status_mapping_id',
  ])('independent source projection suppresses linked status mappings under %s', async alias => {
    state.links = [linkRow(PROJECT_A, 'visible task')];
    state.hidden = new Set([alias]);
    const res = await GET(request());
    expect(res.status).toBe(200);
    const rows = (await res.json()).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      task_id: 'task-visible task',
      task_name: 'visible task',
      project_status_mapping_id: null,
      status_name: null,
      is_closed: null,
    });
  });
  it.each(['project_tasks.updated_at', 'values.tasks.updated_at'])(
    'independent source projection hides copied task timestamps under %s', async alias => {
      state.links = [linkRow(PROJECT_A, 'visible task')];
      state.hidden = new Set([alias]);
      const res = await GET(request());
      expect(res.status).toBe(200);
      expect((await res.json()).data[0]).toMatchObject({
        task_name: 'visible task', task_updated_at: null,
      });
    });
  it.each(['project_status_mappings', 'project_status_mappings.status_id'])(
    'independent source projection suppresses linked status values under %s', async alias => {
      state.links = [linkRow(PROJECT_A, 'visible task')];
      state.hidden = new Set([alias]);
      const res = await GET(request());
      expect(res.status).toBe(200);
      expect((await res.json()).data[0]).toMatchObject({
        task_name: 'visible task', status_name: null, is_closed: null,
      });
    });
  it('independent project suppression removes its links while preserving admitted ticket access', async () => {
    state.links = [linkRow(PROJECT_A, 'visible task')];
    state.hidden = new Set(['projects.project_id']);
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
    expect(getTicketProjectLinksMock).toHaveBeenCalledOnce();
  });
  it.each([
    ['project_ticket_links.task_id', 'task'],
    ['values.task_id', 'task'],
    ['task_id', 'task'],
    ['project_ticket_links.phase_id', 'phase'],
    ['values.phase_id', 'phase'],
    ['phase_id', 'phase'],
    ['project_ticket_links.project_id', 'project'],
    ['values.project_id', 'project'],
    ['project_id', 'project'],
  ])('joined source foreign key alias %s suppresses its entity representation', async (alias, entity) => {
    state.links = [linkRow(PROJECT_A, 'private task')];
    state.hidden = new Set([alias]);
    const res = await GET(request());
    expect(res.status).toBe(200);
    const rows = (await res.json()).data;
    if (entity === 'project' && alias !== 'project_ticket_links.project_id') {
      // These aliases suppress the project identifier itself, so the project
      // gate drops its links before the flattened row is built.
      expect(rows).toEqual([]);
      return;
    }
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (entity === 'task') {
      expect(row).toMatchObject({
        task_id: null,
        task_name: null,
        project_status_mapping_id: null,
        status_name: null,
        is_closed: null,
        task_updated_at: null,
        phase_id: 'phase-1',
        phase_name: 'Backlog',
        project_id: PROJECT_A,
        project_name: 'Project private task',
        bill_under_project: false,
      });
    } else if (entity === 'phase') {
      expect(row).toMatchObject({
        phase_id: null,
        phase_name: null,
        task_id: 'task-private task',
        task_name: 'private task',
        project_id: PROJECT_A,
        project_name: 'Project private task',
        bill_under_project: false,
      });
    } else {
      expect(row).toMatchObject({
        project_id: null,
        project_name: null,
        project_number: null,
        phase_id: 'phase-1',
        phase_name: 'Backlog',
        task_id: 'task-private task',
        task_name: 'private task',
        bill_under_project: false,
      });
    }
  });
});
