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
}));

const authorizeReadMock = vi.hoisted(() =>
  vi.fn(async ({ resource, recordContext }: { resource: string; recordContext: { id: string } }) =>
    state.readable.has(`${resource}:${recordContext.id}`)
  )
);
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

vi.mock('@/lib/api/controllers/authorizationKernel', () => ({
  authorizeApiResourceRead: authorizeReadMock,
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
    authorizeReadMock.mockClear();
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
    // One record check per project, built from the project's own owner and client.
    const projectChecks = authorizeReadMock.mock.calls.filter(([a]) => a.resource === 'project');
    expect(projectChecks).toHaveLength(2);
    expect(projectChecks[0][0]).toMatchObject({ recordContext: { id: PROJECT_A, ownerUserId: 'user-9', clientId: 'client-1' } });
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
    expect((await GET(request())).status).toBe(403);
    state.ticket = null;
    expect((await GET(request())).status).toBe(404);
    expect(getTicketProjectLinksMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed ticket id', async () => {
    expect((await GET(request('not-a-uuid'))).status).toBe(400);
  });
});
